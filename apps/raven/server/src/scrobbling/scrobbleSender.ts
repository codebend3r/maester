import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common'
import { SCROBBLE_SERVICES, type ScrobbleService } from '@raven/core'
import { CLOCK, type Clock } from '@/clock'
import type { AccountKey } from '@/media/viewingAccountKeys'
import { MusicRepository } from '@/music/musicRepository'
import { type RateLimit, createRateLimit, createTaskQueue } from '@/scanner/concurrency'
import { LastFmScrobbler } from '@/scrobbling/lastFmScrobbler'
import { ListenBrainzScrobbler } from '@/scrobbling/listenBrainzScrobbler'
import {
  type Listen,
  type Scrobbler,
  type SendOutcome,
  SEND_OUTCOMES,
} from '@/scrobbling/scrobbler'
import { ScrobbleLinks } from '@/scrobbling/scrobbleLinks'
import { type QueuedListen, ScrobbleQueue } from '@/scrobbling/scrobbleQueue'

/** A failed listen waits this long before its first retry, doubling each time after. */
export const SCROBBLE_RETRY_MS = 60 * 1000

/** The longest a failed listen waits between tries. */
export const SCROBBLE_RETRY_CAP_MS = 6 * 60 * 60 * 1000

/** A listen not sent within this long of when it began is dropped. */
export const SCROBBLE_KEEP_MS = 7 * 24 * 60 * 60 * 1000

/** Each service's name, as the log writes it. */
const SERVICE_NAMES = {
  listenBrainz: 'ListenBrainz',
  lastFm: 'Last.fm',
} as const satisfies Record<ScrobbleService, string>

type ScrobbleSenderNoteListenProps = { mediaId: number; account: AccountKey }

type ScrobbleSenderSettleProps = { listen: QueuedListen; outcome: SendOutcome }

type BackoffOfProps = { attempts: number }

/** How long a listen that has failed `attempts` times before waits for its next try. */
const backoffOf = ({ attempts }: BackoffOfProps): number =>
  Math.min(SCROBBLE_RETRY_MS * 2 ** attempts, SCROBBLE_RETRY_CAP_MS)

/**
 * Sends the queued listens, at one request a second per service, the
 * services side by side. A listen that fails for a moment (no answer, a
 * 429 or a 5xx) is tried again after a minute, then two, doubling up to six
 * hours, and dropped once it is a week old; one the service refuses for
 * good is dropped at once, and a 401 (Last.fm's invalid session) removes
 * the account's link with every listen still waiting for it. Between
 * listens due, it sleeps until the next one is. No token, session key or
 * account id is ever logged.
 */
@Injectable()
export class ScrobbleSender implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(ScrobbleSender.name)
  private readonly tasks = createTaskQueue({ concurrency: Object.keys(SCROBBLE_SERVICES).length })
  private readonly wakes = new Map<ScrobbleService, () => void>()
  private readonly scrobblers: Record<ScrobbleService, Scrobbler>
  private readonly limits: Record<ScrobbleService, RateLimit>
  private isStopping = false

  constructor(
    @Inject(ScrobbleQueue) private readonly queue: ScrobbleQueue,
    @Inject(ScrobbleLinks) private readonly links: ScrobbleLinks,
    @Inject(MusicRepository) private readonly music: MusicRepository,
    @Inject(ListenBrainzScrobbler) listenBrainz: ListenBrainzScrobbler,
    @Inject(LastFmScrobbler) lastFm: LastFmScrobbler,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {
    this.scrobblers = { listenBrainz, lastFm }
    const limitOf = (): RateLimit =>
      createRateLimit({
        perSecond: 1,
        inFlight: 1,
        now: () => this.clock.now(),
        sleep: (ms) =>
          new Promise<void>((resolve) => {
            this.clock.after({ ms, run: resolve })
          }),
      })
    this.limits = { listenBrainz: limitOf(), lastFm: limitOf() }
  }

  /** Sweeps what grew too old while the server was down, a service's left behind while it was off included, then sends. */
  onApplicationBootstrap(): void {
    this.queue.dropBefore({
      seconds: Math.floor((this.clock.now() - SCROBBLE_KEEP_MS) / 1000),
    })
    this.kick()
  }

  onModuleDestroy(): void {
    this.isStopping = true
    this.wakes.forEach((cancel) => cancel())
    this.wakes.clear()
  }

  /** The services this server can send to now. */
  available(): ScrobbleService[] {
    return Object.values(SCROBBLE_SERVICES).filter((service) =>
      this.scrobblers[service].isAvailable(),
    )
  }

  /** A play counted: queues it for each service the account links that can send, and sends. */
  noteListen({ mediaId, account }: ScrobbleSenderNoteListenProps): void {
    const services = this.available()
    if (this.queue.noteListen({ mediaId, account, services }) > 0) this.kick()
  }

  /** Looks for listens due on every service that can send. */
  kick(): void {
    if (this.isStopping) return
    this.available().forEach((service) =>
      this.tasks.again({ key: service, task: () => this.drain(service) }),
    )
  }

  /** Resolves once no listen due now is waiting or being sent; one waiting for a retry is not. */
  whenIdle(): Promise<void> {
    return this.tasks.idle()
  }

  private async drain(service: ScrobbleService): Promise<void> {
    if (this.isStopping) return
    const listen = this.queue.nextDue({ service })
    if (listen === null) {
      this.sleepUntilDue(service)
      return
    }
    await this.limits[service].run(() => this.sendOne(listen))
    return this.drain(service)
  }

  /** Wakes the service's queue when its next listen falls due, in place of an earlier wake. */
  private sleepUntilDue(service: ScrobbleService): void {
    this.wakes.get(service)?.()
    this.wakes.delete(service)
    const at = this.queue.nextAt({ service })
    if (at === null || this.isStopping) return
    const cancel = this.clock.after({
      ms: Math.max(0, at - this.clock.now()),
      run: () => {
        this.wakes.delete(service)
        this.tasks.again({ key: service, task: () => this.drain(service) })
      },
    })
    this.wakes.set(service, cancel)
  }

  private async sendOne(listen: QueuedListen): Promise<void> {
    const { account, service } = listen
    if (this.isStopping) return
    if (this.clock.now() - listen.listenedAt * 1000 > SCROBBLE_KEEP_MS) {
      this.queue.remove(listen)
      return
    }
    const secret = this.links.secretOf({ account, service })
    if (secret === null) {
      // A link whose secret no longer opens (the server's key changed) can send nothing again.
      this.links.remove({ account, service })
      this.logger.warn(
        `An account's ${SERVICE_NAMES[service]} link no longer opens, so it was removed.`,
      )
      return
    }
    const track = this.music.tracks([listen.mediaId]).get(listen.mediaId)
    const artist = track?.artists[0]?.name ?? null
    if (track === undefined || artist === null) {
      this.queue.remove(listen)
      return
    }
    const sent: Listen = {
      listenedAt: listen.listenedAt,
      artist,
      track: track.title,
      album: track.album.title,
      durationSeconds: track.duration,
      recordingMbid: track.mbid,
      releaseMbid: listen.releaseMbid,
    }
    const outcome = await this.scrobblers[service]
      .send({ secret, listen: sent })
      .catch(() => SEND_OUTCOMES.retry)
    this.settle({ listen, outcome })
  }

  private settle({ listen, outcome }: ScrobbleSenderSettleProps): void {
    const { account, service } = listen
    switch (outcome) {
      case SEND_OUTCOMES.sent:
      case SEND_OUTCOMES.rejected:
        this.queue.remove(listen)
        return
      case SEND_OUTCOMES.unlinked:
        this.links.remove({ account, service })
        this.logger.warn(`${SERVICE_NAMES[service]} refused an account's link, so it was removed.`)
        return
      case SEND_OUTCOMES.retry: {
        const nextAt = this.clock.now() + backoffOf({ attempts: listen.attempts })
        if (nextAt - listen.listenedAt * 1000 > SCROBBLE_KEEP_MS) {
          this.queue.remove(listen)
          return
        }
        this.queue.retry({ ...listen, attempts: listen.attempts + 1, nextAt })
        return
      }
      default: {
        const unknown: never = outcome
        throw new Error(`Unknown send outcome ${String(unknown)}`)
      }
    }
  }
}
