import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common'
import { errorMessage } from '@/errorMessage'
import { MetadataRepository, scoresDueBefore } from '@/metadata/metadataRepository'
import type { ScoreProvider, ScoreSource, ScoreTitle } from '@/metadata/scoreSources'
import { Scores } from '@/metadata/scores'
import { createTaskQueue, mapWithConcurrency } from '@/scanner/concurrency'

/** How long the sweep waits to try again after a drain that asked and got no answer at all. */
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
 * How a drain ended: with nothing left it waits on (`done`); with titles
 * waiting on a spent source while another still has calls (`someSpent`);
 * with no source left with calls (`budget`); or having asked and got no
 * answer at all (`unavailable`).
 */
type Stop = 'done' | 'someSpent' | 'budget' | 'unavailable'

/**
 * How a drain's rounds ended: on a round with failures and no answer, or
 * with nothing left to ask; and the sources that answered along the way.
 */
type Drained = { isSilent: boolean; answeredBy: ReadonlySet<ScoreProvider> }

/** What became of one title in a round. */
type Outcome = 'answered' | 'failed' | 'skipped'

/** A minute past the next midnight UTC, when every provider's day has turned. */
const afterMidnight = (now: Date): Date =>
  new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 1))

/**
 * Tops up the scores that are missing or a month old, on a queue of its own
 * so a top-up waiting days on a daily budget never holds up matching. It
 * asks the primary source first, then OMDb for the titles MDBList does not
 * know, two titles at a time. The titles a source failed on are skipped
 * until a drain gets an answer from it, so titles that keep failing cannot
 * hold up the rest. It wakes again after midnight UTC while a spent source
 * still has titles due, and 15 minutes after a drain that got no answer.
 */
@Injectable()
export class ScoreSweep implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(ScoreSweep.name)
  private readonly queue = createTaskQueue({ concurrency: 1 })
  private readonly state: {
    pause: ScorePause | null
    wake: NodeJS.Timeout | null
    isClosed: boolean
    /** The items each source failed on, which later rounds and drains skip until it answers again. */
    failed: Record<ScoreProvider, ReadonlySet<number>>
  } = { pause: null, wake: null, isClosed: false, failed: { mdblist: new Set(), omdb: new Set() } }

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
    const stop = await this.drainOnce().catch((error: unknown) => {
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
   * Tops up, then forgets the failures that should be asked again, and says
   * how the drain ended. Only a drain that asked and got no answer at all
   * tries again in 15 minutes; one that answered and left failures behind
   * waits for the next kick.
   */
  private async drainOnce(): Promise<Stop> {
    const { isSilent, answeredBy } = await this.topUp(new Set())
    // The database closes with the app.
    if (this.state.isClosed) return 'done'
    this.forgetFailures({ answeredBy, hasRunOut: !isSilent })
    if (isSilent && answeredBy.size === 0) return 'unavailable'
    if (!this.isWaitingForMidnight()) return 'done'
    return this.scores.primary() == null ? 'budget' : 'someSpent'
  }

  /**
   * Round after round until nothing is due that a source can be asked for,
   * or a round has failures and no answer. A source whose day runs out
   * midway hands over to the next. Each title that fails joins its source's
   * failures, so later rounds skip it.
   */
  private async topUp(answeredBy: ReadonlySet<ScoreProvider>): Promise<Drained> {
    if (this.state.isClosed) return { isSilent: false, answeredBy }
    const round = this.nextRound()
    if (round == null) return { isSilent: false, answeredBy }
    const { answered, failedIds } = await this.run(round)
    const { provider } = round.source
    this.state.failed = {
      ...this.state.failed,
      [provider]: new Set([...this.state.failed[provider], ...failedIds]),
    }
    const hasAnswered = answered > 0 ? new Set([...answeredBy, provider]) : answeredBy
    if (answered === 0 && failedIds.length > 0) return { isSilent: true, answeredBy: hasAnswered }
    return this.topUp(hasAnswered)
  }

  /**
   * Forgets the failures of each source that answered this drain, so the
   * titles it failed on are asked again on the next. After a drain that ran
   * out of titles to ask, it also forgets those of a source whose due titles
   * have all failed, so the next drain is not left with nothing to ask.
   */
  private forgetFailures({
    answeredBy,
    hasRunOut,
  }: {
    answeredBy: ReadonlySet<ScoreProvider>
    hasRunOut: boolean
  }): void {
    const before = scoresDueBefore()
    const kept = (provider: ScoreProvider): ReadonlySet<number> => {
      const failed = this.state.failed[provider]
      if (answeredBy.has(provider)) return new Set()
      if (!hasRunOut || failed.size === 0) return failed
      const due = this.metadata.scoresDue({ provider, before, limit: failed.size + 1 })
      return due.every((title) => failed.has(title.itemId)) ? new Set() : failed
    }
    this.state.failed = { mdblist: kept('mdblist'), omdb: kept('omdb') }
  }

  /**
   * The primary's due titles, or once those are done, OMDb's for what MDBList
   * does not know, each past the titles that source has failed on.
   */
  private nextRound(): Round | null {
    const { failed } = this.state
    const before = scoresDueBefore()
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
   * to ask and the app is up; one matched or refreshed since the round began
   * is skipped. The round ends early after three failures in a row. A call
   * that spent the source's day, or after which it is no longer the one to
   * ask (a refused key), is no failure: the next round hands over. How many
   * titles answered, and which failed.
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
        if (this.state.isClosed || streak.failedInARow >= GIVE_UP_AFTER || !isCurrent()) {
          return 'skipped'
        }
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
        if (source.remaining() === 0 || !isCurrent()) return 'skipped'
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
    const before = scoresDueBefore()
    return this.scores
      .spent()
      .some(
        (source) =>
          this.metadata.scoresDue({ provider: source.provider, before, limit: 1 }).length > 0,
      )
  }
}
