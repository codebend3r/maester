import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common'
import { RATINGS_REFRESH_STATES, type RatingsRefresh } from '@raven/core'
import { errorMessage } from '@/errorMessage'
import { LibrariesRepository } from '@/libraries/librariesRepository'
import { notFound } from '@/metadata/matchPass'
import { SCORE_PROVIDERS, type ScoreSource } from '@/metadata/scoreSources'
import { Scores } from '@/metadata/scores'
import { type DueScores, ScoresRepository, scoresDueBefore } from '@/metadata/scoresRepository'
import { TmdbClient } from '@/metadata/tmdbClient'
import { createTaskQueue, mapWithConcurrency } from '@/scanner/concurrency'

/** How long the sweep waits to try again after a drain that asked and got no answer at all. */
export const RETRY_MS = 15 * 60 * 1000

/** How many titles are asked about at once. */
const AT_ONCE = 2

/** The sweep's one key on its queue. */
const SWEEP_TASKS = { drain: 'drain' } as const

/** How many requested titles a round asks TMDB alone about, which has no daily budget to keep to. */
const TMDB_ROUND = 50

/**
 * How many failed calls in a row end a round: enough to step past a title
 * that keeps failing, few enough that a source that is down does not spend
 * the day's calls, each of which counts whether it answers or not.
 */
export const GIVE_UP_AFTER = 3

/**
 * How many failures of the source that settles a Refresh's request, counted
 * at most once per `RETRY_MS`, it takes to give the title up, so one that
 * source always fails on cannot hold the Refresh open for good.
 */
export const REQUEST_TRIES = 3

/** How old the first of those failures must be, so an outage or presses close together give nothing up. */
export const REQUEST_PATIENCE_MS = 24 * 60 * 60 * 1000

/** The failures counted on one requested title: how many, and when the first and the last were. */
type RequestFailures = { count: number; firstAt: number; lastAt: number }

/** Why a Refresh waits, as the contract names it: the day's calls spent, or no source answering. */
type PauseReason = Extract<
  RatingsRefresh,
  { state: typeof RATINGS_REFRESH_STATES.waiting }
>['reason']

const PAUSE_REASONS = {
  budget: 'budget',
  unavailable: 'unavailable',
} as const satisfies Record<PauseReason, PauseReason>

/** Why the sweep stopped with scores still due, and when it starts again. */
export type ScorePause = { reason: PauseReason; resumesAt: string }

/** Who a round asks: a score source, or TMDB alone for a Refresh's titles while no score source has a usable key. */
const ASKED = { ...SCORE_PROVIDERS, tmdb: 'tmdb' } as const

type Asked = (typeof ASKED)[keyof typeof ASKED]

/** The titles due from whoever a round asks, and how each is asked for while that one is still the one to ask. */
type Round = {
  asked: Asked
  due: DueScores[]
  /** Whether a title is still due, by the rule it was listed by. */
  isDue: (title: DueScores) => boolean
  isCurrent: () => boolean
  /** Whether today's calls ran out, which hands the round over rather than failing the title. */
  isSpent: () => boolean
  fetch: (title: DueScores) => Promise<boolean>
}

/**
 * How a drain ended: with nothing left it waits on (`done`); with titles a
 * Refresh asked for left that the source settling them can still be asked
 * for today (`requests`); with titles waiting on a spent source while
 * another still has calls (`someSpent`); with no source left with calls
 * (`budget`); or having asked and got no answer at all (`unavailable`).
 */
const STOPS = {
  done: 'done',
  requests: 'requests',
  someSpent: 'someSpent',
  budget: 'budget',
  unavailable: 'unavailable',
} as const

type Stop = (typeof STOPS)[keyof typeof STOPS]

/**
 * How a drain's rounds ended: on a round with failures and no answer, or
 * with nothing left to ask; and who answered along the way.
 */
type Drained = { isSilent: boolean; answeredBy: ReadonlySet<Asked> }

/** What became of one title in a round. */
const OUTCOMES = { answered: 'answered', failed: 'failed', skipped: 'skipped' } as const

type Outcome = (typeof OUTCOMES)[keyof typeof OUTCOMES]

/** What the log says when the sweep sets its next wake, before the time. */
const WAKE_NOTES = {
  unavailable: 'No score source answered; trying again at',
  spent: 'Scores from a source whose calls are spent today wait for',
  requests: 'Titles a Refresh asked for and has yet to get are asked again at',
} as const

/** A minute past the next midnight UTC, when every provider's day has turned. */
const afterMidnight = (now: Date): Date =>
  new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 1))

type ScoreSweepWakeAtProps = {
  at: Date
  pause: ScorePause['reason'] | null
  why: keyof typeof WAKE_NOTES
}

type ScoreSweepForgetFailuresProps = {
  answeredBy: ReadonlySet<Asked>
  hasRunOut: boolean
}

type ScoreSweepCountRequestFailuresProps = {
  round: Round
  failedIds: readonly number[]
}

type ScoreSweepSourceRoundProps = {
  source: ScoreSource
  before: string
  isCurrent: () => boolean
  fetch: (title: DueScores) => Promise<boolean>
}

type ScoreSweepDueProps = {
  asked: Asked
  before: string
  limit: number
}

type ScoreSweepListDueProps = {
  asked: Asked
  before: string
  limit: number
}

/**
 * Tops up the scores that are missing or a month old, and those a library's
 * Refresh asked for, on a queue of its own so a top-up waiting days on a
 * daily budget never holds up matching. It asks the primary source first,
 * then OMDb for the titles MDBList does not know, two titles at a time, and
 * TMDB too for its own score of each title a Refresh asked for. The titles
 * a source failed on are skipped until a drain gets an answer from it, so
 * titles that keep failing cannot hold up the rest. It wakes again after
 * midnight UTC while a spent source still has titles due, 15 minutes after
 * a drain that got no answer, and 15 minutes after any drain while a
 * Refresh still waits on titles the source settling them can be asked for.
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
    failed: Record<Asked, ReadonlySet<number>>
    /** The failures counted on each requested item by the source that settles it, since a restart. */
    requestFailures: ReadonlyMap<number, RequestFailures>
  } = {
    pause: null,
    wake: null,
    isClosed: false,
    failed: { mdblist: new Set(), omdb: new Set(), tmdb: new Set() },
    requestFailures: new Map(),
  }

  constructor(
    @Inject(ScoresRepository) private readonly stored: ScoresRepository,
    @Inject(Scores) private readonly scores: Scores,
    @Inject(LibrariesRepository) private readonly libraries: LibrariesRepository,
    @Inject(TmdbClient) private readonly tmdb: Pick<TmdbClient, 'score' | 'enabled'>,
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

  /**
   * Whether a Refresh's request could ever be settled: a score source has a
   * usable key, or TMDB can be asked for its own score.
   */
  canSettle(): boolean {
    return this.scores.settler() != null || this.tmdb.enabled
  }

  /**
   * Why the titles a Refresh asked for wait, and until when: midnight UTC
   * while the source that settles them has spent its day, whatever else
   * waits, as nothing settles them before; else the sweep's own pause.
   */
  requestsPause(): ScorePause | null {
    if (this.isSettlerSpent()) {
      return { reason: PAUSE_REASONS.budget, resumesAt: afterMidnight(new Date()).toISOString() }
    }
    return this.state.pause
  }

  private async drain(): Promise<void> {
    this.state.pause = null
    const stop = await this.drainOnce().catch((error: unknown) => {
      this.logger.error(`Topping up scores failed: ${errorMessage(error)}`)
      return STOPS.unavailable
    })
    if (this.state.wake) clearTimeout(this.state.wake)
    this.state.wake = null
    const retry = new Date(Date.now() + RETRY_MS)
    switch (stop) {
      case STOPS.done:
        return
      case STOPS.requests:
        this.wakeAt({ at: retry, pause: PAUSE_REASONS.unavailable, why: 'requests' })
        return
      case STOPS.someSpent:
        this.wakeAt({ at: afterMidnight(new Date()), pause: null, why: 'spent' })
        return
      case STOPS.budget:
        this.wakeAt({ at: afterMidnight(new Date()), pause: PAUSE_REASONS.budget, why: 'spent' })
        return
      case STOPS.unavailable:
        this.wakeAt({ at: retry, pause: PAUSE_REASONS.unavailable, why: 'unavailable' })
        return
      default: {
        const unknown: never = stop
        throw new Error(`Unknown stop ${String(unknown)}`)
      }
    }
  }

  /** Kicks a drain at `at`, saying why the sweep waits when `pause` names a reason. */
  private wakeAt({ at, pause, why }: ScoreSweepWakeAtProps): void {
    const resumesAt = at.toISOString()
    this.state.pause = pause == null ? null : { reason: pause, resumesAt }
    if (this.state.isClosed) return
    this.logger.log(`${WAKE_NOTES[why]} ${resumesAt}.`)
    this.state.wake = setTimeout(() => this.kick(), at.getTime() - Date.now())
    this.state.wake.unref()
  }

  /**
   * Tops up, then forgets the failures that should be asked again, settles
   * what it can, and says how the drain ended. A drain that asked and got no
   * answer at all tries again in 15 minutes, and so does one that leaves a
   * Refresh waiting on titles the source settling them can still be asked
   * for, so failed ones do not wait a day; one that answered and left other
   * failures behind waits for the next kick.
   */
  private async drainOnce(): Promise<Stop> {
    const { isSilent, answeredBy } = await this.topUp(new Set())
    // The database closes with the app.
    if (this.state.isClosed) return STOPS.done
    this.forgetFailures({ answeredBy, hasRunOut: !isSilent })
    this.settle()
    if (isSilent && answeredBy.size === 0) return STOPS.unavailable
    if (this.stored.hasRequests() && !this.isSettlerSpent()) return STOPS.requests
    if (!this.isWaitingForMidnight()) return STOPS.done
    return this.scores.primary() == null ? STOPS.budget : STOPS.someSpent
  }

  /**
   * Round after round until nothing is due that a source can be asked for,
   * a round has failures and no answer, or a round asks nothing while its
   * source is still the one to ask, which would only list the same titles
   * again. A source whose day runs out midway hands over to the next. Each
   * title that fails joins its source's failures, so later rounds skip it.
   */
  private async topUp(answeredBy: ReadonlySet<Asked>): Promise<Drained> {
    if (this.state.isClosed) return { isSilent: false, answeredBy }
    const round = this.nextRound()
    if (round == null) return { isSilent: false, answeredBy }
    const { answered, failedIds } = await this.run(round)
    const { asked } = round
    this.state.failed = {
      ...this.state.failed,
      [asked]: new Set([...this.state.failed[asked], ...failedIds]),
    }
    if (!this.state.isClosed) this.countRequestFailures({ round, failedIds })
    const hasAnswered = answered > 0 ? new Set([...answeredBy, asked]) : answeredBy
    if (answered === 0 && failedIds.length > 0) return { isSilent: true, answeredBy: hasAnswered }
    if (answered === 0 && round.isCurrent()) return { isSilent: false, answeredBy: hasAnswered }
    if (!this.state.isClosed) this.settle()
    return this.topUp(hasAnswered)
  }

  /**
   * Forgets the failures of each source that answered this drain, so the
   * titles it failed on are asked again on the next. After a drain that ran
   * out of titles to ask, it also forgets those of a source whose due titles
   * have all failed, so the next drain is not left with nothing to ask.
   */
  private forgetFailures({ answeredBy, hasRunOut }: ScoreSweepForgetFailuresProps): void {
    const before = scoresDueBefore()
    const kept = (asked: Asked): ReadonlySet<number> => {
      const failed = this.state.failed[asked]
      if (answeredBy.has(asked)) return new Set()
      if (!hasRunOut || failed.size === 0) return failed
      const due = this.listDue({ asked, before, limit: failed.size + 1 })
      return due.every((title) => failed.has(title.itemId)) ? new Set() : failed
    }
    this.state.failed = {
      mdblist: kept(ASKED.mdblist),
      omdb: kept(ASKED.omdb),
      tmdb: kept(ASKED.tmdb),
    }
  }

  /**
   * Counts the failures of the source that settles a Refresh's requests on
   * the titles it asked for, one at most per `RETRY_MS` for each, and gives
   * up each title with `REQUEST_TRIES` of them, the first a day old or more:
   * its request goes, and it keeps the scores it had.
   */
  private countRequestFailures({ round, failedIds }: ScoreSweepCountRequestFailuresProps): void {
    if (round.asked !== (this.scores.settler()?.provider ?? ASKED.tmdb)) return
    const now = Date.now()
    const failed = new Set(failedIds)
    const counts = round.due
      .filter((title) => title.isRequested && failed.has(title.itemId))
      .reduce((counted, { itemId }) => {
        const before = counted.get(itemId)
        if (before == null) return counted.set(itemId, { count: 1, firstAt: now, lastAt: now })
        if (now - before.lastAt < RETRY_MS) return counted
        return counted.set(itemId, { ...before, count: before.count + 1, lastAt: now })
      }, new Map(this.state.requestFailures))
    const givenUp = [...counts].flatMap(([itemId, { count, firstAt }]) =>
      count >= REQUEST_TRIES && now - firstAt >= REQUEST_PATIENCE_MS ? [itemId] : [],
    )
    givenUp.forEach((itemId) => {
      this.stored.clearRequest(itemId)
      this.logger.warn(
        `Gave up on item ${itemId} for a Refresh after a day of failed calls; it keeps the scores it had.`,
      )
    })
    this.state.requestFailures = new Map(
      [...counts].filter(([itemId]) => !givenUp.includes(itemId)),
    )
  }

  /**
   * Settles the requests the source that settles them has answered since
   * their Refresh began, which matters once that source has changed (a key
   * refused or taken away), forgets the failures counted on titles no
   * longer requested, and finishes each Refresh with nothing left. Once no
   * source can settle a request at all, every Refresh stops waiting.
   */
  private settle(): void {
    if (!this.canSettle() && this.stored.hasRequests()) {
      this.stored.clearRequests()
      this.logger.warn(
        'No source can answer a Refresh now, so it stops waiting; its titles keep the scores they had.',
      )
    }
    const settler = this.scores.settler()
    if (settler != null) this.stored.settleRequests(settler.provider)
    this.state.requestFailures = new Map(
      [...this.state.requestFailures].filter(([itemId]) => this.stored.isRequested(itemId)),
    )
    this.libraries.finishRatingsRefreshes(new Date().toISOString())
  }

  /**
   * The primary's due titles, or once those are done, OMDb's for what MDBList
   * does not know, each past the titles that source has failed on. With no
   * score source that has a usable key, TMDB's score alone for the titles a
   * Refresh asked for.
   */
  private nextRound(): Round | null {
    const before = scoresDueBefore()
    const primary = this.scores.primary()
    if (primary == null) {
      return this.scores.settler() == null && this.tmdb.enabled ? this.tmdbRound() : null
    }
    const first = this.sourceRound({
      source: primary,
      before,
      isCurrent: () => this.scores.primary() === primary,
      fetch: (title) => this.scores.fetch(title),
    })
    if (first.due.length > 0) return first
    const fallback = this.scores.fallback()
    if (fallback == null) return null
    const second = this.sourceRound({
      source: fallback,
      before,
      isCurrent: () => this.scores.fallback() === fallback,
      fetch: (title) => this.scores.fetchFallback(title),
    })
    return second.due.length > 0 ? second : null
  }

  /** A score source's round: its due titles as of `before`, as far as its calls left today go. */
  private sourceRound({ source, before, isCurrent, fetch }: ScoreSweepSourceRoundProps): Round {
    const { provider } = source
    return {
      asked: provider,
      due: this.due({ asked: provider, before, limit: source.remaining() }),
      isDue: ({ itemId }) => this.stored.isScoreDue({ itemId, provider, before }),
      isCurrent,
      isSpent: () => source.remaining() === 0,
      fetch: async (title) => {
        if (title.isRequested && this.tmdb.enabled) await this.fetchTmdbScore(title)
        // While TMDB answered, another title's call may have spent this source's day; the next round asks.
        if (this.state.isClosed || !isCurrent()) return false
        return fetch(title)
      },
    }
  }

  /** The titles a Refresh asked for, each settled by TMDB's score alone, while no score source has a usable key. */
  private tmdbRound(): Round | null {
    const due = this.due({ asked: ASKED.tmdb, before: scoresDueBefore(), limit: TMDB_ROUND })
    if (due.length === 0) return null
    return {
      asked: ASKED.tmdb,
      due,
      isDue: ({ itemId }) => this.stored.isRequested(itemId),
      isCurrent: () => this.scores.settler() == null,
      isSpent: () => false,
      fetch: async (title) => {
        if (!(await this.fetchTmdbScore(title))) return false
        this.stored.clearRequest(title.itemId)
        return true
      },
    }
  }

  /** The titles due from `asked` but those it failed on, as far as `limit` goes. */
  private due({ asked, before, limit }: ScoreSweepDueProps): DueScores[] {
    const skip = this.state.failed[asked]
    return this.listDue({ asked, before, limit: limit + skip.size })
      .filter((title) => !skip.has(title.itemId))
      .slice(0, limit)
  }

  /** What `asked` has due, in the order it is asked: a source's due scores, or the titles a Refresh asked for. */
  private listDue({ asked, before, limit }: ScoreSweepListDueProps): DueScores[] {
    return asked === ASKED.tmdb
      ? this.stored.requestedTitles(limit)
      : this.stored.scoresDue({ provider: asked, before, limit })
  }

  /**
   * Fetches TMDB's own score for a title and keeps it. A title TMDB no
   * longer has keeps the score it had, and counts as answered, as there is
   * nothing to ask it for. False when the call failed.
   */
  private async fetchTmdbScore({ itemId, type, tmdbId }: DueScores): Promise<boolean> {
    try {
      const rating = await this.tmdb.score({ type, tmdbId })
      if (this.state.isClosed) return false
      this.stored.saveTmdbRating({ itemId, rating })
      return true
    } catch (error) {
      if (notFound(error)) return true
      this.logger.warn(`No TMDB score for ${type} ${tmdbId}: ${errorMessage(error)}`)
      return false
    }
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
    due,
    isDue,
    isCurrent,
    isSpent,
    fetch,
  }: Round): Promise<{ answered: number; failedIds: number[] }> {
    const streak = { failedInARow: 0 }
    const outcomes = await mapWithConcurrency({
      items: due,
      limit: AT_ONCE,
      fn: async (title): Promise<Outcome> => {
        if (this.state.isClosed || streak.failedInARow >= GIVE_UP_AFTER || !isCurrent()) {
          return OUTCOMES.skipped
        }
        if (!isDue(title)) return OUTCOMES.skipped
        if (await fetch(title)) {
          streak.failedInARow = 0
          return OUTCOMES.answered
        }
        if (this.state.isClosed || isSpent() || !isCurrent()) return OUTCOMES.skipped
        streak.failedInARow += 1
        return OUTCOMES.failed
      },
    })
    return {
      answered: outcomes.filter((outcome) => outcome === OUTCOMES.answered).length,
      failedIds: due.flatMap((title, index) =>
        outcomes[index] === OUTCOMES.failed ? [title.itemId] : [],
      ),
    }
  }

  /** Whether the source that settles a Refresh's requests has a usable key and has spent today's calls. */
  private isSettlerSpent(): boolean {
    const settler = this.scores.settler()
    return settler != null && settler.remaining() === 0
  }

  /** Whether a source with a key has spent today's calls while titles still wait on it. */
  private isWaitingForMidnight(): boolean {
    const before = scoresDueBefore()
    return this.scores
      .spent()
      .some(
        (source) =>
          this.stored.scoresDue({ provider: source.provider, before, limit: 1 }).length > 0,
      )
  }
}
