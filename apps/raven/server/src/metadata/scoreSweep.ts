import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common'
import { errorMessage } from '@/errorMessage'
import { MetadataRepository } from '@/metadata/metadataRepository'
import type { ScoreProvider, ScoreSource, ScoreTitle } from '@/metadata/scoreSources'
import { Scores } from '@/metadata/scores'
import { createTaskQueue, mapWithConcurrency } from '@/scanner/concurrency'

const DAY_MS = 24 * 60 * 60 * 1000

/** How long the sweep waits to try again after a source seemed down or titles failed. */
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
 * source left with calls (`budget`); or with a source that seemed down, or
 * titles that failed, to try again (`unavailable`).
 */
type Stop = 'done' | 'someSpent' | 'budget' | 'unavailable'

/**
 * What one drain has learned so far: the items each source failed on, which
 * its later rounds skip so they cannot starve it, and whether its last round
 * had failures and no answer.
 */
type Progress = { failed: Record<ScoreProvider, ReadonlySet<number>>; wasLastSilent: boolean }

/** What became of one title in a round. */
type Outcome = 'answered' | 'failed' | 'skipped'

/** A minute past the next midnight UTC, when every provider's day has turned. */
const afterMidnight = (now: Date): Date =>
  new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 1))

/**
 * Tops up the scores that are missing or a month old, on a queue of its own
 * so a top-up waiting days on a daily budget never holds up matching. It
 * asks the primary source first, then OMDb for the titles MDBList does not
 * know, two titles at a time. It wakes again after midnight UTC while a
 * spent source still has titles due, and 15 minutes after a source seemed
 * down or titles failed.
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
    const start: Progress = {
      failed: { mdblist: new Set(), omdb: new Set() },
      wasLastSilent: false,
    }
    const stop = await this.topUp(start).catch((error: unknown) => {
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
        ? `Some scores could not be fetched; trying again at ${resumesAt}.`
        : `Scores from a source whose calls are spent today wait for ${resumesAt}.`,
    )
    this.state.wake = setTimeout(() => this.kick(), at.getTime() - Date.now())
    this.state.wake.unref()
  }

  /**
   * Round after round until nothing is due that a source can be asked for.
   * A source whose day runs out midway hands over to the next. A title that
   * fails is skipped for the rest of the drain, and tried again on the next.
   * Two rounds in a row with failures and no answer take the source as down.
   */
  private async topUp(progress: Progress): Promise<Stop> {
    const round = this.nextRound(progress)
    if (round != null) {
      const { answered, failedIds } = await this.run(round)
      const isSilent = answered === 0 && failedIds.length > 0
      if (isSilent && progress.wasLastSilent) return 'unavailable'
      const { provider } = round.source
      return this.topUp({
        failed: {
          ...progress.failed,
          [provider]: new Set([...progress.failed[provider], ...failedIds]),
        },
        wasLastSilent: isSilent,
      })
    }
    const isWaitingForMidnight = this.isWaitingForMidnight()
    if (isWaitingForMidnight && this.scores.primary() == null) return 'budget'
    if (Object.values(progress.failed).some((ids) => ids.size > 0)) return 'unavailable'
    return isWaitingForMidnight ? 'someSpent' : 'done'
  }

  /**
   * The primary's due titles, or once those are done, OMDb's for what MDBList
   * does not know, each past the titles that source failed on this drain.
   */
  private nextRound({ failed }: Progress): Round | null {
    const before = new Date(Date.now() - 30 * DAY_MS).toISOString()
    const primary = this.scores.primary()
    if (primary == null) return null
    const due = this.due({ source: primary, before, skip: failed[primary.provider] })
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
    const fallbackDue = this.due({ source: fallback, before, skip: failed[fallback.provider] })
    if (fallbackDue.length === 0) return null
    return {
      source: fallback,
      due: fallbackDue,
      before,
      isCurrent: () => this.scores.fallback() === fallback,
      fetch: (title) => this.scores.fetchFallback(title),
    }
  }

  /** A source's due titles but those in `skip`, as far as its calls left today go. */
  private due({
    source,
    before,
    skip,
  }: {
    source: ScoreSource
    before: string
    skip: ReadonlySet<number>
  }): DueTitle[] {
    const limit = source.remaining()
    return this.metadata
      .scoresDue({ provider: source.provider, before, limit: limit + skip.size })
      .filter((title) => !skip.has(title.itemId))
      .slice(0, limit)
  }

  /**
   * Asks for each title still due while the round's source is still the one
   * to ask; one matched or refreshed since the round began is skipped. The
   * round ends early after three failures in a row. A call that spent the
   * source's day is no failure: the next round hands over. How many titles
   * answered, and which failed.
   */
  private async run({
    source,
    due,
    before,
    isCurrent,
    fetch,
  }: Round): Promise<{ answered: number; failedIds: number[] }> {
    const streak = { failedInARow: 0 }
    const outcomes = await mapWithConcurrency({
      items: due,
      limit: AT_ONCE,
      fn: async (title): Promise<Outcome> => {
        if (streak.failedInARow >= GIVE_UP_AFTER || !isCurrent()) return 'skipped'
        const isDue = this.metadata.isScoreDue({
          itemId: title.itemId,
          provider: source.provider,
          before,
        })
        if (!isDue) return 'skipped'
        if (await fetch(title)) {
          streak.failedInARow = 0
          return 'answered'
        }
        if (source.remaining() === 0) return 'skipped'
        streak.failedInARow += 1
        return 'failed'
      },
    })
    return {
      answered: outcomes.filter((outcome) => outcome === 'answered').length,
      failedIds: due.flatMap((title, index) =>
        outcomes[index] === 'failed' ? [title.itemId] : [],
      ),
    }
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
