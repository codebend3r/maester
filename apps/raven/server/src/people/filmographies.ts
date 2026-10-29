import { Inject, Injectable, Logger } from '@nestjs/common'
import { FILMOGRAPHY_STATES, type PersonFilmography } from '@raven/core'
import { errorMessage } from '@/errorMessage'
import { type LocalCredit, MetadataRepository } from '@/metadata/metadataRepository'
import { TmdbClient } from '@/metadata/tmdbClient'
import { toEntries } from '@/people/filmography'
import { PeopleRepository } from '@/people/peopleRepository'
import { createGate } from '@/scanner/concurrency'

const DAY_MS = 24 * 60 * 60 * 1000

/** A filmography younger than this is served as it is; an older one is served while it is fetched again. */
export const FRESH_DAYS = 14

/** How long a failed fetch is remembered, so a page polling for it does not ask TMDB each time. */
export const FAILURE_MEMORY_MS = 600_000

/** How long a first view waits for TMDB before it answers `pending`. */
export const DEADLINE_MS = 2500

/** How many people are fetched at once. */
const AT_ONCE = 2

/** How many fetches may wait their turn; past that, a page goes without until the line moves. */
export const MOST_WAITING = 20

type FilmographiesEnsureProps = { personId: number }

type FilmographiesReadProps = {
  personId: number
  sees: (libraryId: number) => boolean
  localCredits: readonly LocalCredit[]
  isTurnedAway?: boolean
}

type FilmographiesFetchProps = { personId: number; tmdbId: string }

type FilmographiesLoadProps = { personId: number; tmdbId: string }

/**
 * Each person's whole filmography from TMDB, fetched when their page is
 * first asked for and again once it is two weeks old. One fetch per person
 * at a time, two people at once, and twenty more waiting.
 */
@Injectable()
export class Filmographies {
  private readonly logger = new Logger(Filmographies.name)
  private readonly inFlight = new Map<number, Promise<void>>()
  private readonly gate = createGate({ limit: AT_ONCE })
  private readonly failedAt = new Map<number, number>()

  constructor(
    @Inject(TmdbClient) private readonly tmdb: Pick<TmdbClient, 'enabled' | 'person'>,
    @Inject(PeopleRepository) private readonly people: PeopleRepository,
    @Inject(MetadataRepository) private readonly metadata: MetadataRepository,
  ) {}

  /**
   * Fetches a person's filmography when it is missing, waiting for it until
   * the deadline, or behind the stored one when that is stale. Never throws.
   * `isTurnedAway` says a first fetch was wanted but the line was full.
   */
  async ensure({ personId }: FilmographiesEnsureProps): Promise<{ isTurnedAway: boolean }> {
    const stored = this.people.profile(personId)
    if (!stored) return { isTurnedAway: false }
    const { tmdbId, fetchedAt } = stored
    if (fetchedAt != null) {
      const isFresh = Date.now() - Date.parse(fetchedAt) < FRESH_DAYS * DAY_MS
      if (!isFresh && this.mayFetch(personId)) void this.fetch({ personId, tmdbId })
      return { isTurnedAway: false }
    }
    if (!this.mayFetch(personId)) return { isTurnedAway: false }
    const fetching = this.fetch({ personId, tmdbId })
    if (!fetching) return { isTurnedAway: true }
    await this.withinDeadline(fetching)
    return { isTurnedAway: false }
  }

  /**
   * What a viewer who sees the libraries `sees` passes may see of a person's
   * filmography. One `ensure` turned away is `pending`, so the page asks
   * again once the line moves.
   */
  read({
    personId,
    sees,
    localCredits,
    isTurnedAway = false,
  }: FilmographiesReadProps): PersonFilmography {
    const fetchedAt = this.people.profile(personId)?.fetchedAt ?? null
    if (fetchedAt == null) {
      return { state: isTurnedAway || this.inFlight.has(personId) ? 'pending' : 'unavailable' }
    }
    const rows = this.people.filmographyRows(personId)
    const itemIds = rows.flatMap((row) => row.itemId ?? [])
    return {
      state: FILMOGRAPHY_STATES.ready,
      fetchedAt,
      entries: toEntries({
        rows,
        holding: this.metadata.librariesHoldingEach(itemIds),
        sees,
        summaries: this.metadata.summaries({ ids: itemIds, libraryId: null }),
        localCredits,
      }),
    }
  }

  /** TMDB is on, and has not failed this person in the last ten minutes. */
  private mayFetch(personId: number): boolean {
    const failed = this.failedAt.get(personId)
    return this.tmdb.enabled && (failed == null || Date.now() - failed >= FAILURE_MEMORY_MS)
  }

  /**
   * The person's fetch, started or joined, or null when the line is full.
   * That is no failure of this person's, so the next view tries again.
   */
  private fetch({ personId, tmdbId }: FilmographiesFetchProps): Promise<void> | null {
    const running = this.inFlight.get(personId)
    if (running) return running
    if (this.inFlight.size >= AT_ONCE + MOST_WAITING) return null
    const fetching = this.load({ personId, tmdbId }).finally(() => {
      this.inFlight.delete(personId)
    })
    this.inFlight.set(personId, fetching)
    return fetching
  }

  /** Fetches and stores a filmography. It never rejects: a failure is remembered instead. */
  private async load({ personId, tmdbId }: FilmographiesLoadProps): Promise<void> {
    try {
      const person = await this.gate.run(() => this.tmdb.person(tmdbId))
      this.people.saveFilmography({ personId, tmdbId, person, at: new Date().toISOString() })
      this.failedAt.delete(personId)
    } catch (error) {
      this.failedAt.set(personId, Date.now())
      this.logger.warn(`No filmography for TMDB person ${tmdbId}: ${errorMessage(error)}`)
    }
  }

  /** Waits for `work` until the deadline at most; past it, `work` carries on alone. */
  private async withinDeadline(work: Promise<void>): Promise<void> {
    const deadline = { stop: () => {} }
    const timeUp = new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, DEADLINE_MS)
      deadline.stop = () => clearTimeout(timer)
    })
    try {
      await Promise.race([work, timeUp])
    } finally {
      deadline.stop()
    }
  }
}
