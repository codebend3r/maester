import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common'
import { errorMessage } from '@/errorMessage'
import { MetadataRepository } from '@/metadata/metadataRepository'
import type { ScoreSource, ScoreTitle } from '@/metadata/scoreSources'
import { Scores } from '@/metadata/scores'
import { createTaskQueue, mapWithConcurrency } from '@/scanner/concurrency'

const DAY_MS = 24 * 60 * 60 * 1000

/** How long a failed call waits before the sweep tries again. */
export const RETRY_MS = 15 * 60 * 1000

/** How many titles are asked about at once. */
const AT_ONCE = 2

/** The sweep's one key on its queue. */
const SWEEP_TASKS = { drain: 'drain' } as const

/** Why the sweep stopped with scores still due, and when it starts again. */
export type ScorePause = { reason: 'budget' | 'unavailable'; resumesAt: string }

type DueTitle = ScoreTitle & { itemId: number }

/** One source's due titles, and how each is asked for while that source is still the one to ask. */
type Round = {
  source: ScoreSource
  due: DueTitle[]
  isCurrent: () => boolean
  fetch: (title: DueTitle) => Promise<boolean>
}

/** A minute past the next midnight UTC, when every provider's day has turned. */
const afterMidnight = (now: Date): Date =>
  new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 1))

/**
 * Tops up the scores that are missing or a month old, on a queue of its own
 * so a top-up waiting days on a daily budget never holds up matching. It
 * asks the primary source first, then OMDb for the titles MDBList does not
 * know, two titles at a time. Once no source has calls left it waits for
 * midnight UTC, and after a failed call 15 minutes.
 */
@Injectable()
export class ScoreSweep implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(ScoreSweep.name)
  private readonly queue = createTaskQueue({ concurrency: 1 })
  private readonly state: {
    pause: ScorePause | null
    wake: NodeJS.Timeout | null
    isClosed: boolean
  } = { pause: null, wake: null, isClosed: false }

  constructor(
    @Inject(MetadataRepository) private readonly metadata: MetadataRepository,
    @Inject(Scores) private readonly scores: Scores,
  ) {}

  onApplicationBootstrap(): void {
    this.kick()
  }

  onModuleDestroy(): void {
    this.state.isClosed = true
    if (this.state.wake) clearTimeout(this.state.wake)
  }

  /** Queues a drain; one already waiting covers this, and one running is followed by another. */
  kick(): void {
    this.queue.again({ key: SWEEP_TASKS.drain, task: () => this.drain() })
  }

  whenIdle(): Promise<void> {
    return this.queue.idle()
  }

  /** Why the last drain stopped short and when the next starts; null when it ran out of work. */
  pause(): ScorePause | null {
    return this.state.pause
  }

  private async drain(): Promise<void> {
    this.state.pause = null
    const stop = await this.topUp().catch((error: unknown) => {
      this.logger.error(`Topping up scores failed: ${errorMessage(error)}`)
      return 'unavailable' as const
    })
    if (this.state.wake) clearTimeout(this.state.wake)
    this.state.wake = null
    if (stop === 'done') return
    const resumesAt =
      stop === 'budget' ? afterMidnight(new Date()) : new Date(Date.now() + RETRY_MS)
    const pause = { reason: stop, resumesAt: resumesAt.toISOString() }
    this.state.pause = pause
    if (this.state.isClosed) return
    this.logger.log(
      stop === 'budget'
        ? `Today's score calls are spent; the rest wait for ${pause.resumesAt}.`
        : `A score source failed; trying again at ${pause.resumesAt}.`,
    )
    this.state.wake = setTimeout(() => this.kick(), resumesAt.getTime() - Date.now())
    this.state.wake.unref()
  }

  /**
   * Round after round until nothing is due that a source can be asked for.
   * A source whose day runs out midway hands over to the next; only when
   * none has calls left does the sweep wait for midnight.
   */
  private async topUp(): Promise<'done' | 'budget' | 'unavailable'> {
    const round = this.nextRound()
    if (round != null) return (await this.run(round)) ? this.topUp() : 'unavailable'
    return this.scores.primary() == null && this.isWaitingForMidnight() ? 'budget' : 'done'
  }

  /** The primary's due titles, or once those are done, OMDb's for what MDBList does not know. */
  private nextRound(): Round | null {
    const primary = this.scores.primary()
    if (primary == null) return null
    const due = this.due({ source: primary, limit: primary.remaining() })
    if (due.length > 0) {
      return {
        source: primary,
        due,
        isCurrent: () => this.scores.primary() === primary,
        fetch: (title) => this.scores.fetch(title),
      }
    }
    const fallback = this.scores.fallback()
    if (fallback == null) return null
    const fallbackDue = this.due({ source: fallback, limit: fallback.remaining() })
    if (fallbackDue.length === 0) return null
    return {
      source: fallback,
      due: fallbackDue,
      isCurrent: () => this.scores.fallback() === fallback,
      fetch: (title) => this.scores.fetchFallback(title),
    }
  }

  /**
   * Asks for each title while the round's source is still the one to ask,
   * stopping at the first failure. A call that spent the source's day is no
   * failure: the next round hands over. False when a call failed.
   */
  private async run({ source, due, isCurrent, fetch }: Round): Promise<boolean> {
    const progress = { hasFailed: false }
    await mapWithConcurrency({
      items: due,
      limit: AT_ONCE,
      fn: async (title) => {
        if (progress.hasFailed || !isCurrent()) return
        const isAnswered = await fetch(title)
        if (!isAnswered && source.remaining() > 0) progress.hasFailed = true
      },
    })
    return !progress.hasFailed
  }

  /** Whether a source with a key has spent today's calls while titles still wait on it. */
  private isWaitingForMidnight(): boolean {
    return this.scores.spent().some((source) => this.due({ source, limit: 1 }).length > 0)
  }

  private due({ source, limit }: { source: ScoreSource; limit: number }): DueTitle[] {
    return this.metadata.scoresDue({
      provider: source.provider,
      before: new Date(Date.now() - 30 * DAY_MS).toISOString(),
      limit,
    })
  }
}
