import { Inject, Injectable } from '@nestjs/common'
import {
  isMatchItemType,
  isRatingSource,
  type Rating,
  RATING_KINDS,
  type RatingSource,
} from '@raven/core'
import type Sqlite from 'better-sqlite3'
import { DatabaseService } from '@/db/database'
import { LOCAL } from '@/metadata/localItems'
import type { ExternalScore, ScoreProvider, ScoreTitle } from '@/metadata/scoreSources'
import type { FetchedItem } from '@/metadata/tmdbShapes'

/** The column that notes when each provider last answered for an item. */
const FETCHED_AT = {
  omdb: 'omdb_fetched_at',
  mdblist: 'mdblist_fetched_at',
} as const satisfies Record<ScoreProvider, string>

/**
 * When an item's scores from each provider are due, as SQL over `items` with
 * `@before`. MDBList's are due when it has never answered or answered before
 * then. OMDb's are due for a title with an IMDb id when OMDb has not answered
 * since, and MDBList has not either or gave it no scores: the titles it does
 * not know, whose fallback may have failed.
 */
const SCORES_DUE = {
  mdblist: '(mdblist_fetched_at IS NULL OR mdblist_fetched_at < @before)',
  omdb: `imdb_id IS NOT NULL
    AND (omdb_fetched_at IS NULL OR omdb_fetched_at < @before)
    AND (mdblist_fetched_at IS NULL OR mdblist_fetched_at < @before
         OR NOT EXISTS (SELECT 1 FROM ratings r
                         WHERE r.item_id = items.id AND r.provider = 'mdblist'))`,
} as const satisfies Record<ScoreProvider, string>

/**
 * Whether a library's Refresh asked for an item's scores and `provider` has
 * not answered since that Refresh began, as SQL over `items`: so each
 * provider is asked once a Refresh, past the 30-day wait, whether or not
 * its answer settles the request.
 */
const requestedFrom = (provider: ScoreProvider): string =>
  `EXISTS (SELECT 1 FROM score_requests r JOIN libraries l ON l.id = r.library_id
            WHERE r.item_id = items.id
              AND (items.${FETCHED_AT[provider]} IS NULL
                   OR items.${FETCHED_AT[provider]} < l.ratings_refresh_started_at))`

/**
 * The movies and shows whose scores from `provider` are due, by their age
 * or a Refresh, leaving out titles raven made up.
 */
const scoresDueWhere = (provider: ScoreProvider): string =>
  `type IN ('movie', 'show') AND tmdb_id NOT GLOB @local
   AND ((${SCORES_DUE[provider]}) OR ${requestedFrom(provider)})`

/**
 * The order each provider's due scores are fetched in. MDBList's: first the
 * titles it has never answered that lack a Rotten Tomatoes or Metacritic
 * score, then the rest it has never answered, then the oldest. OMDb's: those
 * neither provider has answered for the longest first.
 */
const SCORES_ORDER = {
  mdblist: `CASE WHEN mdblist_fetched_at IS NOT NULL THEN 2
                 WHEN EXISTS (SELECT 1 FROM ratings r
                               WHERE r.item_id = items.id AND r.source = 'rottenTomatoes')
                  AND EXISTS (SELECT 1 FROM ratings r
                               WHERE r.item_id = items.id AND r.source = 'metacritic') THEN 1
                 ELSE 0 END,
            mdblist_fetched_at, id`,
  // MAX of two columns is NULL when either is, so a stamp never set counts as ''.
  omdb: "MAX(COALESCE(omdb_fetched_at, ''), COALESCE(mdblist_fetched_at, '')), id",
} as const satisfies Record<ScoreProvider, string>

/** Rotten Tomatoes and Metacritic are critics; TMDB and IMDb are audiences. */
const RATING_KIND_OF: Record<RatingSource, Rating['kind']> = {
  tmdb: RATING_KINDS.audience,
  imdb: RATING_KINDS.audience,
  rottenTomatoes: RATING_KINDS.critic,
  metacritic: RATING_KINDS.critic,
}

const DAY_MS = 24 * 60 * 60 * 1000

/** How old a provider's answer gets before its scores are due again. */
const SCORES_DUE_DAYS = 30

/** The time before which a provider's answer is due again, as `scoresDue` takes it. */
export const scoresDueBefore = (): string =>
  new Date(Date.now() - SCORES_DUE_DAYS * DAY_MS).toISOString()

/** A movie or show whose scores are due, and whether a Refresh asked for it. */
export type DueScores = ScoreTitle & { itemId: number; isRequested: boolean }

type DueRow = {
  id: number
  type: string
  tmdb_id: string
  imdb_id: string | null
  requested: number
}

const toDueScores = (row: DueRow): DueScores[] =>
  isMatchItemType(row.type)
    ? [
        {
          itemId: row.id,
          type: row.type,
          tmdbId: row.tmdb_id,
          imdbId: row.imdb_id,
          isRequested: row.requested === 1,
        },
      ]
    : []

type ScoresRepositorySaveScoresProps = {
  itemId: number
  provider: ScoreProvider
  scores: readonly ExternalScore[]
}

type ScoresRepositorySaveTmdbRatingProps = { itemId: number; rating: FetchedItem['rating'] }

type ScoresRepositoryScoresDueProps = {
  provider: ScoreProvider
  before: string
  limit: number
}

type ScoresRepositoryIsScoreDueProps = {
  itemId: number
  provider: ScoreProvider
  before: string
}

/**
 * The scores each movie and show holds, from TMDB and the score providers,
 * when each provider last answered for it, and the titles a library's
 * Refresh still waits on.
 */
@Injectable()
export class ScoresRepository {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  private get db(): Sqlite.Database {
    return this.database.db
  }

  /** Every score each item has, keyed by item, sources in the order the page shows them. */
  ratingsFor(ids: readonly number[]): Map<number, Rating[]> {
    return this.db
      .prepare<[string], { item_id: number; source: string; value: number; votes: number | null }>(
        `SELECT item_id, source, value, votes FROM ratings
          WHERE item_id IN (SELECT value FROM json_each(?))
          ORDER BY item_id, CASE source WHEN 'rottenTomatoes' THEN 0 WHEN 'imdb' THEN 1
                                        WHEN 'metacritic' THEN 2 ELSE 3 END`,
      )
      .all(JSON.stringify(ids))
      .reduce((byItem, row) => {
        if (!isRatingSource(row.source)) return byItem
        const rating: Rating = {
          source: row.source,
          kind: RATING_KIND_OF[row.source],
          value: row.value,
          votes: row.votes,
        }
        return byItem.set(row.item_id, [...(byItem.get(row.item_id) ?? []), rating])
      }, new Map<number, Rating[]>())
  }

  /**
   * Stores what one provider answered for an item and notes when. The rows
   * it wrote before and no longer sends go; the others' rows stay. OMDb
   * writes over an MDBList score only once MDBList's answer is due again, so
   * scores from an MDBList that has gone away do not freeze.
   */
  saveScores({ itemId, provider, scores }: ScoresRepositorySaveScoresProps): void {
    this.db.transaction(() => {
      const stamped = this.db
        .prepare(`UPDATE items SET ${FETCHED_AT[provider]} = ? WHERE id = ?`)
        .run(new Date().toISOString(), itemId)
      // The item went while its scores were asked for; a row for it would break the foreign key.
      if (stamped.changes === 0) return
      this.db
        .prepare(
          `DELETE FROM ratings
            WHERE item_id = ? AND provider = ? AND source <> 'tmdb'
              AND source NOT IN (SELECT value FROM json_each(?))`,
        )
        .run(itemId, provider, JSON.stringify(scores.map((score) => score.source)))
      const upsert = this.db.prepare(
        `INSERT INTO ratings (item_id, source, value, votes, provider) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (item_id, source) DO UPDATE
           SET value = excluded.value, votes = excluded.votes, provider = excluded.provider
         WHERE ratings.provider = excluded.provider OR excluded.provider = 'mdblist'
            OR (SELECT COALESCE(mdblist_fetched_at, '') FROM items WHERE id = excluded.item_id) < ?`,
      )
      const before = scoresDueBefore()
      scores.forEach((score) =>
        upsert.run(itemId, score.source, score.value, score.votes, provider, before),
      )
    })()
  }

  /** Replaces an item's TMDB score, or drops it for none; nothing for an item that has gone. */
  saveTmdbRating({ itemId, rating }: ScoresRepositorySaveTmdbRatingProps): void {
    this.db.transaction(() => {
      this.db.prepare(`DELETE FROM ratings WHERE item_id = ? AND source = 'tmdb'`).run(itemId)
      if (rating == null) return
      this.db
        .prepare(
          `INSERT INTO ratings (item_id, source, value, votes)
           SELECT id, 'tmdb', ?, ? FROM items WHERE id = ?`,
        )
        .run(rating.value, rating.votes, itemId)
    })()
  }

  /**
   * Movies and shows whose scores from `provider` are due, in the order they
   * are fetched, as far as `limit` goes: those a Refresh asked for first.
   */
  scoresDue({ provider, before, limit }: ScoresRepositoryScoresDueProps): DueScores[] {
    return this.db
      .prepare<{ local: string; before: string; limit: number }, DueRow>(
        `SELECT id, type, tmdb_id, imdb_id, ${requestedFrom(provider)} AS requested FROM items
          WHERE ${scoresDueWhere(provider)}
          ORDER BY requested DESC, ${SCORES_ORDER[provider]}
          LIMIT @limit`,
      )
      .all({ local: `${LOCAL}*`, before, limit })
      .flatMap(toDueScores)
  }

  /** How many titles a library's Refresh asked for are still waiting. */
  requestsLeft(libraryId: number): number {
    return (
      this.db
        .prepare<[number], { requests: number }>(
          'SELECT COUNT(*) AS requests FROM score_requests WHERE library_id = ?',
        )
        .get(libraryId)?.requests ?? 0
    )
  }

  /** Whether any library's Refresh still waits on a title. */
  hasRequests(): boolean {
    return !!this.db.prepare('SELECT 1 FROM score_requests LIMIT 1').get()
  }

  /** Whether a Refresh still waits on the item. */
  isRequested(itemId: number): boolean {
    return !!this.db.prepare('SELECT 1 FROM score_requests WHERE item_id = ? LIMIT 1').get(itemId)
  }

  /** The titles a Refresh still waits on, as far as `limit` goes. */
  requestedTitles(limit: number): DueScores[] {
    return this.db
      .prepare<[number], DueRow>(
        `SELECT id, type, tmdb_id, imdb_id, 1 AS requested FROM items
          WHERE id IN (SELECT item_id FROM score_requests)
          ORDER BY id
          LIMIT ?`,
      )
      .all(limit)
      .flatMap(toDueScores)
  }

  /** Settles every library's request for the item's scores. */
  clearRequest(itemId: number): void {
    this.db.prepare('DELETE FROM score_requests WHERE item_id = ?').run(itemId)
  }

  /** Drops a library's requests, for a Refresh the admin cancelled. */
  clearLibraryRequests(libraryId: number): void {
    this.db.prepare('DELETE FROM score_requests WHERE library_id = ?').run(libraryId)
  }

  /** Drops every request, for when no source could ever answer one. */
  clearRequests(): void {
    this.db.prepare('DELETE FROM score_requests').run()
  }

  /**
   * Settles each request `provider` has answered since its Refresh began:
   * those it answered before it became the provider that settles them.
   */
  settleRequests(provider: ScoreProvider): void {
    this.db
      .prepare(
        `DELETE FROM score_requests
          WHERE (SELECT ${FETCHED_AT[provider]} FROM items WHERE id = score_requests.item_id)
                >= (SELECT ratings_refresh_started_at FROM libraries
                     WHERE id = score_requests.library_id)`,
      )
      .run()
  }

  /** Whether an item's scores from `provider` are still due, by the rule `scoresDue` lists them by. */
  isScoreDue({ itemId, provider, before }: ScoresRepositoryIsScoreDueProps): boolean {
    return !!this.db
      .prepare<{ id: number; local: string; before: string }, { id: number }>(
        `SELECT id FROM items WHERE id = @id AND ${scoresDueWhere(provider)}`,
      )
      .get({ id: itemId, local: `${LOCAL}*`, before })
  }
}
