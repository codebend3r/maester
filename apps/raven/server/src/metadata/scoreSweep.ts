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

/** How long a round with no answer waits before the sweep tries again. */
export const RETRY_MS = 15 * 60 * 1000

/** How many titles are asked about at once. */
const AT_ONCE = 2

/** The sweep's one key on its queue. */
const SWEEP_TASKS = { drain: 'drain' } as const

/**
 * How many failed calls in a row end a round: enough to step past a title
 * that keeps failing, few enough that a source that is down does not spend
 * the day's calls, each of which counts whether it answers or not.
 */
export const GIVE_UP_AFTER = 3

/** Why the sweep stopped with scores still due, and when it starts again. */
export type ScorePause = { reason: 'budget' | 'unavailable'; resumesAt: string }

type DueTitle = ScoreTitle & { itemId: number }

/** One source's due titles as of `before`, and how each is asked for while that source is still the one to ask. */
type Round = {
  source: ScoreSource
  due: DueTitle[]
  before: string
  isCurrent: () => boolean
  fetch: (title: DueTitle) => Promise<boolean>
}

/**
 * How a drain ended: with nothing left it can ask for; with titles waiting
 * on a spent source while another still has calls (`someSpent`); with no
 * source left with calls (`budget`); or with a round no source answered.
 */
type Stop = 'done' | 'someSpent' | 'budget' | 'unavailable'

/** A minute past the next midnight UTC, when every provider's day has turned. */
const afterMidnight = (now: Date): Date =>
  new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 1))

/**
 * Tops up the scores that are missing or a month old, on a queue of its own
 * so a top-up waiting days on a daily budget never holds up matching. It
 * asks the primary source first, then OMDb for the titles MDBList does not
 * know, two titles at a time. It wakes again after midnight UTC while a
 * spent source still has titles due, and 15 minutes after a round no source
 * answered.
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
    this.queue.cancel(SWEEP_TASKS.drain)
    if (this.state.wake) clearTimeout(this.state.wake)
  }

  /** Queues a drain; one already waiting covers this, and one running is followed by another. */
  kick(): void {
    if (this.state.isClosed) return
    this.queue.again({ key: SWEEP_TASKS.drain, task: () => this.drain() })
  }

  whenIdle(): Promise<void> {
    return this.queue.idle()
  }

  /** Why the last drain stopped short and when the next starts; null while one runs or none must wait. */
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
    switch (stop) {
      case 'done':
        return
      case 'someSpent':
        this.wakeAt({ at: afterMidnight(new Date()), pause: null })
        return
      case 'budget':
        this.wakeAt({ at: afterMidnight(new Date()), pause: 'budget' })
        return
      case 'unavailable':
        this.wakeAt({ at: new Date(Date.now() + RETRY_MS), pause: 'unavailable' })
        return
      default: {
        const unknown: never = stop
        throw new Error(`Unknown stop ${String(unknown)}`)
      }
    }
  }

  /** Kicks a drain at `at`, saying why the sweep waits when `pause` names a reason. */
  private wakeAt({ at, pause }: { at: Date; pause: ScorePause['reason'] | null }): void {
    const resumesAt = at.toISOString()
    this.state.pause = pause == null ? null : { reason: pause, resumesAt }
    if (this.state.isClosed) return
    this.logger.log(
      pause === 'unavailable'
        ? `No score source answered; trying again at ${resumesAt}.`
        : `Scores from a source whose calls are spent today wait for ${resumesAt}.`,
    )
    this.state.wake = setTimeout(() => this.kick(), at.getTime() - Date.now())
    this.state.wake.unref()
  }

  /**
   * Round after round until nothing is due that a source can be asked for.
   * A source whose day runs out midway hands over to the next; a round with
   * any answer goes on to the next, and one with failures and no answer
   * stops the drain.
   */
  private async topUp(): Promise<Stop> {
    const round = this.nextRound()
    if (round != null) return (await this.run(round)) ? this.topUp() : 'unavailable'
    if (!this.isWaitingForMidnight()) return 'done'
    return this.scores.primary() == null ? 'budget' : 'someSpent'
  }

  /** The primary's due titles, or once those are done, OMDb's for what MDBList does not know. */
  private nextRound(): Round | null {
    const before = new Date(Date.now() - 30 * DAY_MS).toISOString()
    const primary = this.scores.primary()
    if (primary == null) return null
    const due = this.metadata.scoresDue({
      provider: primary.provider,
      before,
      limit: primary.remaining(),
    })
    if (due.length > 0) {
      return {
        source: primary,
        due,
        before,
        isCurrent: () => this.scores.primary() === primary,
        fetch: (title) => this.scores.fetch(title),
      }
    }
    const fallback = this.scores.fallback()
    if (fallback == null) return null
    const fallbackDue = this.metadata.scoresDue({
      provider: fallback.provider,
      before,
      limit: fallback.remaining(),
    })
    if (fallbackDue.length === 0) return null
    return {
      source: fallback,
      due: fallbackDue,
      before,
      isCurrent: () => this.scores.fallback() === fallback,
      fetch: (title) => this.scores.fetchFallback(title),
    }
  }

  /**
   * Asks for each title still due while the round's source is still the one
   * to ask; one matched or refreshed since the round began is skipped. A
   * title that fails keeps its place for a later round. A call that spent
   * the source's day is no failure: the next round hands over. False when
   * the round had failures and no answer.
   */
  private async run({ source, due, before, isCurrent, fetch }: Round): Promise<boolean> {
    const tally = { answered: 0, failed: 0, failedInARow: 0 }
    await mapWithConcurrency({
      items: due,
      limit: AT_ONCE,
      fn: async (title) => {
        if (tally.failedInARow >= GIVE_UP_AFTER || !isCurrent()) return
        const isDue = this.metadata.isScoreDue({
          itemId: title.itemId,
          provider: source.provider,
          before,
        })
        if (!isDue) return
        if (await fetch(title)) {
          tally.answered += 1
          tally.failedInARow = 0
          return
        }
        if (source.remaining() === 0) return
        tally.failed += 1
        tally.failedInARow += 1
      },
    })
    return tally.answered > 0 || tally.failed === 0
  }

  /** Whether a source with a key has spent today's calls while titles still wait on it. */
  private isWaitingForMidnight(): boolean {
    const before = new Date(Date.now() - 30 * DAY_MS).toISOString()
    return this.scores
      .spent()
      .some(
        (source) =>
          this.metadata.scoresDue({ provider: source.provider, before, limit: 1 }).length > 0,
      )
  }
}
