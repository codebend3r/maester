import { Inject, Injectable } from '@nestjs/common'
import {
  type Credit,
  isCreditJob,
  isItemType,
  isMatchItemType,
  isRatingSource,
  isStringArray,
  ITEM_IMAGE_KINDS,
  ITEM_TYPES,
  type ItemDetails,
  type ItemSummary,
  type ItemType,
  type MatchItemType,
  type PersonDetails,
  type Rating,
  RATING_KINDS,
  type RatingSource,
  type Review,
  sortTitle,
} from '@raven/core'
import type Sqlite from 'better-sqlite3'
import { DatabaseService } from '@/db/database'
import { parseJsonAs } from '@/db/json'
import { ItemImagesRepository, lineOf, versionOf } from '@/metadata/itemImagesRepository'
import { LOCAL } from '@/metadata/localItems'
import type { ExternalScore, ScoreProvider, ScoreTitle } from '@/metadata/scoreSources'
import type { FetchedItem, FetchedSaga, MovieExtras } from '@/metadata/tmdbClient'

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

/** The movies and shows whose scores from `provider` are due, leaving out titles raven made up. */
const scoresDueWhere = (provider: ScoreProvider): string =>
  `type IN ('movie', 'show') AND tmdb_id NOT GLOB @local AND ${SCORES_DUE[provider]}`

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

type ItemRow = {
  id: number
  type: string
  tmdb_id: string
  parent_id: number | null
  number: number | null
  title: string
  original_title: string | null
  year: number | null
  released: string | null
  ended: string | null
  summary: string | null
  tagline: string | null
  content_rating: string | null
  runtime: number | null
  studio: string | null
  genres: string
  imdb_id: string | null
  fetched_at: string
}

type SummaryRow = {
  id: number
  type: string
  title: string
  year: number | null
  number: number | null
  parent_number: number | null
  show_id: number | null
  show_title: string | null
}

/**
 * `under(root, id)`: each item `roots` selects (as `root, id` pairs of
 * itself), and every item beneath it. "A file somewhere under it" is then
 * one join to `media_items`, whichever level the file is linked at: a show,
 * a season or an episode.
 */
const under = (roots: string): string => `under(root, id) AS (
  ${roots}
  UNION SELECT u.root, i.id FROM items i JOIN under u ON i.parent_id = u.id)`

/** A stored item as matching and refreshing need it. */
export type StoredItem = {
  id: number
  type: ItemType
  tmdbId: string
  parentId: number | null
  /** A season's or episode's number; null for a movie or show. */
  number: number | null
}

/** A credit on a movie or show raven holds, with the title's TMDB id and date, which only the server reads. */
export type LocalCredit = PersonDetails['credits'][number] & {
  tmdbId: string
  released: string | null
}

/** A person as raven's own credits know them; what TMDB says of them is the people store's. */
export type StoredPerson = Pick<PersonDetails, 'id' | 'tmdbId' | 'name' | 'photoVersion'> & {
  credits: LocalCredit[]
}

/** Changes whenever a person's TMDB photo does; null when they have none. */
export const photoVersionOf = (photo: string | null): string | null =>
  photo == null ? null : versionOf(`tmdb:${photo}`)

const DAY_MS = 24 * 60 * 60 * 1000

/** A person whose filmography was fetched this recently keeps their id with no credits left. */
const FILMOGRAPHY_KEPT_DAYS = 180

const genresOf = (json: string): string[] => parseJsonAs({ json, guard: isStringArray }) ?? []

/** Movies, shows, seasons and episodes as TMDB describes them, with their people, scores and pictures. */
@Injectable()
export class MetadataRepository {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(ItemImagesRepository) private readonly images: ItemImagesRepository,
  ) {}

  private get db(): Sqlite.Database {
    return this.database.db
  }

  /** The stored item for a TMDB id, and when it was fetched. */
  find({
    type,
    tmdbId,
  }: {
    type: ItemType
    tmdbId: string
  }): { id: number; fetchedAt: string } | null {
    const row = this.db
      .prepare<[string, string], { id: number; fetched_at: string }>(
        'SELECT id, fetched_at FROM items WHERE type = ? AND tmdb_id = ?',
      )
      .get(type, tmdbId)
    return row ? { id: row.id, fetchedAt: row.fetched_at } : null
  }

  /** A show's seasons, or a season's episodes, in order. */
  childIds(parentId: number): number[] {
    return this.db
      .prepare<[number], { id: number }>(
        'SELECT id FROM items WHERE parent_id = ? ORDER BY number IS NULL, number, id',
      )
      .all(parentId)
      .map((row) => row.id)
  }

  /**
   * A season's episodes, or a show's seasons, by number. Of two with one
   * number, the later wins: TMDB's, once it lists one raven made up before.
   */
  childNumbers(parentId: number): Map<number, number> {
    return new Map(
      this.db
        .prepare<[number], { id: number; number: number }>(
          'SELECT id, number FROM items WHERE parent_id = ? AND number IS NOT NULL ORDER BY id',
        )
        .all(parentId)
        .map((row) => [row.number, row.id]),
    )
  }

  /** The children with a file somewhere beneath them: a show's seasons on disk, a season's episodes on disk. */
  childrenOnDisk(parentId: number): ItemSummary[] {
    const ids = this.db
      .prepare<[number], { id: number }>(
        `WITH RECURSIVE ${under('SELECT id, id FROM items WHERE parent_id = ?')}
         SELECT c.id FROM items c
          WHERE c.id IN (SELECT u.root FROM under u JOIN media_items mi ON mi.item_id = u.id)
          ORDER BY c.number IS NULL, c.number, c.id`,
      )
      .all(parentId)
      .map((row) => row.id)
    const summaries = this.summaries(ids)
    return ids.flatMap((id) => summaries.get(id) ?? [])
  }

  /** Each season's episodes with a file, by season, in one read: what a season card counts. */
  episodesOnDisk(seasonIds: readonly number[]): Map<number, number[]> {
    if (seasonIds.length === 0) return new Map()
    return this.db
      .prepare<[string], { season_id: number; episode_id: number }>(
        `SELECT DISTINCT e.parent_id AS season_id, e.id AS episode_id
           FROM items e JOIN media_items mi ON mi.item_id = e.id
          WHERE e.type = 'episode' AND e.parent_id IN (SELECT value FROM json_each(?))
          ORDER BY e.number IS NULL, e.number, e.id`,
      )
      .all(JSON.stringify(seasonIds))
      .reduce(
        (bySeason, row) =>
          bySeason.set(row.season_id, [...(bySeason.get(row.season_id) ?? []), row.episode_id]),
        new Map<number, number[]>(),
      )
  }

  /** What an episode's row on its season's page shows beside its card, for each episode, in two reads. */
  episodeRows(ids: readonly number[]): Map<
    number,
    {
      summary: string | null
      released: string | null
      runtime: number | null
      stillVersion: string | null
    }
  > {
    if (ids.length === 0) return new Map()
    const stills = this.images.versions({ ids, kind: 'still' })
    return new Map(
      this.db
        .prepare<
          [string],
          { id: number; summary: string | null; released: string | null; runtime: number | null }
        >(
          `SELECT id, summary, released, runtime FROM shown_items
            WHERE id IN (SELECT value FROM json_each(?))`,
        )
        .all(JSON.stringify(ids))
        .map((row) => [
          row.id,
          {
            summary: row.summary,
            released: row.released,
            runtime: row.runtime,
            stillVersion: stills.get(row.id) ?? null,
          },
        ]),
    )
  }

  /** The child of `parentId` with `number`: a show's season, or a season's episode. */
  child({
    parentId,
    number,
  }: {
    parentId: number
    number: number
  }): { id: number; tmdbId: string; fetchedAt: string } | null {
    const row = this.db
      .prepare<[number, number], { id: number; tmdb_id: string; fetched_at: string }>(
        'SELECT id, tmdb_id, fetched_at FROM items WHERE parent_id = ? AND number = ? ORDER BY id LIMIT 1',
      )
      .get(parentId, number)
    return row ? { id: row.id, tmdbId: row.tmdb_id, fetchedAt: row.fetched_at } : null
  }

  /** Every file linked to the item or to anything under it: a show's, its seasons' and its episodes'. */
  mediaUnder(itemId: number): number[] {
    return this.db
      .prepare<[number], { media_id: number }>(
        `WITH RECURSIVE ${under('SELECT id, id FROM items WHERE id = ?')}
         SELECT DISTINCT mi.media_id FROM under u JOIN media_items mi ON mi.item_id = u.id`,
      )
      .all(itemId)
      .map((row) => row.media_id)
  }

  /** The item and everything under it: a show, its seasons and their episodes. */
  itemsUnder(itemId: number): number[] {
    return this.db
      .prepare<[number], { id: number }>(
        `WITH RECURSIVE ${under('SELECT id, id FROM items WHERE id = ?')} SELECT id FROM under`,
      )
      .all(itemId)
      .map((row) => row.id)
  }

  get(id: number): StoredItem | null {
    const row = this.db
      .prepare<
        [number],
        {
          id: number
          type: string
          tmdb_id: string
          parent_id: number | null
          number: number | null
        }
      >('SELECT id, type, tmdb_id, parent_id, number FROM items WHERE id = ?')
      .get(id)
    return row && isItemType(row.type)
      ? {
          id: row.id,
          type: row.type,
          tmdbId: row.tmdb_id,
          parentId: row.parent_id,
          number: row.number,
        }
      : null
  }

  /**
   * Stores what TMDB said about an item, replacing what was there: its
   * fields, its TMDB pictures, its TMDB score, and its credits, with the
   * people they name. Pictures from beside the media stay.
   */
  save({ item, parentId = null }: { item: FetchedItem; parentId?: number | null }): number {
    return this.db.transaction(() => {
      const row = this.db
        .prepare<unknown[], { id: number }>(
          `INSERT INTO items (type, tmdb_id, parent_id, number, title, original_title, sort_title, year,
                              released, ended, summary, tagline, content_rating, runtime, studio, genres,
                              imdb_id, tvdb_id, fetched_at, saga_tmdb_id, saga_name, saga_checked,
                              logo_checked)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 1)
           ON CONFLICT (type, tmdb_id) DO UPDATE SET
             parent_id = excluded.parent_id, number = excluded.number, title = excluded.title,
             original_title = excluded.original_title, sort_title = excluded.sort_title,
             year = excluded.year, released = excluded.released, ended = excluded.ended,
             summary = excluded.summary, tagline = excluded.tagline,
             content_rating = excluded.content_rating, runtime = excluded.runtime,
             studio = excluded.studio, genres = excluded.genres, imdb_id = excluded.imdb_id,
             tvdb_id = excluded.tvdb_id, fetched_at = excluded.fetched_at,
             saga_tmdb_id = excluded.saga_tmdb_id, saga_name = excluded.saga_name, saga_checked = 1,
             logo_checked = 1
           RETURNING id`,
        )
        .get(
          item.type,
          item.tmdbId,
          parentId,
          item.number,
          item.title,
          item.originalTitle,
          sortTitle(item.title),
          item.year,
          item.released,
          item.ended,
          item.summary,
          item.tagline,
          item.contentRating,
          item.runtime,
          item.studio,
          JSON.stringify(item.genres),
          item.imdbId,
          item.tvdbId,
          new Date().toISOString(),
          item.saga?.tmdbId ?? null,
          item.saga?.name ?? null,
        )
      if (!row) throw new Error(`Could not store ${item.type} ${item.tmdbId}`)
      const id = row.id

      this.db.prepare(`DELETE FROM item_images WHERE item_id = ? AND source = 'tmdb'`).run(id)
      const image = this.db.prepare(
        `INSERT INTO item_images (item_id, kind, source, ref) VALUES (?, ?, 'tmdb', ?)`,
      )
      Object.entries(item.images).forEach(([kind, ref]) => {
        if (ref != null) image.run(id, kind, ref)
      })

      this.db.prepare(`DELETE FROM ratings WHERE item_id = ? AND source = 'tmdb'`).run(id)
      if (item.rating) {
        this.db
          .prepare(`INSERT INTO ratings (item_id, source, value, votes) VALUES (?, 'tmdb', ?, ?)`)
          .run(id, item.rating.value, item.rating.votes)
      }

      this.db.prepare('DELETE FROM reviews WHERE item_id = ?').run(id)
      const review = this.db.prepare(
        `INSERT INTO reviews (item_id, tmdb_id, author, avatar, rating, content, url, written_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (tmdb_id) DO UPDATE SET
           item_id = excluded.item_id, author = excluded.author, avatar = excluded.avatar,
           rating = excluded.rating, content = excluded.content, url = excluded.url,
           written_at = excluded.written_at`,
      )
      item.reviews.forEach((entry) =>
        review.run(
          id,
          entry.tmdbId,
          entry.author,
          entry.avatar,
          entry.rating,
          entry.content,
          entry.url,
          entry.writtenAt,
        ),
      )

      this.db.prepare('DELETE FROM credits WHERE item_id = ?').run(id)
      const person = this.db.prepare<[string, string, string | null], { id: number }>(
        `INSERT INTO people (tmdb_id, name, photo) VALUES (?, ?, ?)
         ON CONFLICT (tmdb_id) DO UPDATE SET name = excluded.name, photo = excluded.photo
         RETURNING id`,
      )
      const credit = this.db.prepare(
        `INSERT INTO credits (item_id, person_id, job, role, position) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (item_id, person_id, job) DO NOTHING`,
      )
      item.credits.forEach((entry, position) => {
        const stored = person.get(entry.tmdbId, entry.name, entry.photo)
        if (stored) credit.run(id, stored.id, entry.job, entry.role, position)
      })
      return id
    })()
  }

  /**
   * Stores season `number` of a show and its episodes as TMDB lists them, in
   * one transaction, and answers with the season and every episode under it
   * by number, those raven made up before included.
   */
  saveSeason({
    showId,
    number,
    season,
    episodes,
  }: {
    showId: number
    number: number
    season: FetchedItem
    episodes: readonly FetchedItem[]
  }): { id: number; number: number; episodes: Map<number, number> } {
    return this.db.transaction(() => {
      const id = this.save({ item: season, parentId: showId })
      episodes.forEach((episode) => this.save({ item: episode, parentId: id }))
      return { id, number, episodes: this.childNumbers(id) }
    })()
  }

  /** Sort titles again with the current rule, for items stored under an older one. */
  resortTitles(): void {
    const rows = this.db
      .prepare<[], { id: number; title: string; sort_title: string }>(
        'SELECT id, title, sort_title FROM items',
      )
      .all()
    const update = this.db.prepare('UPDATE items SET sort_title = ? WHERE id = ?')
    this.db.transaction(() =>
      rows
        .filter((row) => sortTitle(row.title) !== row.sort_title)
        .forEach((row) => update.run(sortTitle(row.title), row.id)),
    )()
  }

  /** Every score each item has, keyed by item, sources in the order the page shows them. */
  private ratingsFor(ids: readonly number[]): Map<number, Rating[]> {
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

  /** What a card needs for each item, keyed by id. */
  summaries(ids: readonly number[]): Map<number, ItemSummary> {
    if (ids.length === 0) return new Map()
    const unique = [...new Set(ids)]
    const ratings = this.ratingsFor(unique)
    const rows = this.db
      .prepare<[string], SummaryRow>(
        `SELECT i.id, i.type, i.title, i.year, i.number,
                p.number AS parent_number,
                CASE i.type WHEN 'season' THEN p.id WHEN 'episode' THEN g.id END AS show_id,
                CASE i.type WHEN 'season' THEN p.title WHEN 'episode' THEN g.title END AS show_title
           FROM shown_items i
           LEFT JOIN shown_items p ON p.id = i.parent_id
           LEFT JOIN shown_items g ON g.id = p.parent_id
          WHERE i.id IN (SELECT value FROM json_each(?))`,
      )
      .all(JSON.stringify(unique))
    const posters = this.images.versions({ ids: unique, kind: 'poster' })
    const backdrops = this.images.versions({ ids: unique, kind: 'backdrop' })
    return new Map(
      rows.flatMap((row): Array<[number, ItemSummary]> => {
        if (!isItemType(row.type)) return []
        return [
          [
            row.id,
            {
              id: row.id,
              type: row.type,
              title: row.title,
              year: row.year,
              show:
                row.show_id != null && row.show_title != null
                  ? { id: row.show_id, title: row.show_title }
                  : null,
              season:
                row.type === ITEM_TYPES.season
                  ? row.number
                  : row.type === ITEM_TYPES.episode
                    ? row.parent_number
                    : null,
              episode: row.type === ITEM_TYPES.episode ? row.number : null,
              posterVersion: posters.get(row.id) ?? null,
              backdropVersion: backdrops.get(row.id) ?? null,
              ratings: ratings.get(row.id) ?? [],
            },
          ],
        ]
      }),
    )
  }

  /**
   * The item whose poster stands for each item: its own, else its parent's,
   * else its grandparent's, so an episode shows its season's poster and a
   * season without one its show's. An item with none up the line is left out.
   */
  posterItems(ids: readonly number[]): Map<number, ItemSummary> {
    if (ids.length === 0) return new Map()
    const lines = this.images.lines(ids)
    const summaries = this.summaries(lines.flatMap(lineOf))
    return new Map(
      lines.flatMap((line): Array<[number, ItemSummary]> => {
        const poster = lineOf(line)
          .map((id) => summaries.get(id))
          .find((summary) => summary?.posterVersion != null)
        return poster ? [[line.id, poster]] : []
      }),
    )
  }

  /** The saga each of these items belongs to; one in none is left out. */
  sagasOf(ids: readonly number[]): Map<number, FetchedSaga> {
    if (ids.length === 0) return new Map()
    return new Map(
      this.db
        .prepare<[string], { id: number; saga_tmdb_id: string; saga_name: string }>(
          `SELECT id, saga_tmdb_id, saga_name FROM items
            WHERE saga_tmdb_id IS NOT NULL AND saga_name IS NOT NULL
              AND id IN (SELECT value FROM json_each(?))`,
        )
        .all(JSON.stringify([...new Set(ids)]))
        .map((row) => [row.id, { tmdbId: row.saga_tmdb_id, name: row.saga_name }]),
    )
  }

  /**
   * Movies stored before raven kept sagas or logos, and shows stored before
   * it kept logos, which have yet to learn them. Items raven made up are
   * never fetched, so none of them is listed.
   */
  extrasUnchecked(): Array<{ id: number; type: MatchItemType; tmdbId: string }> {
    return this.db
      .prepare<[string], { id: number; type: string; tmdb_id: string }>(
        `SELECT id, type, tmdb_id FROM items
          WHERE ((type = 'movie' AND (saga_checked = 0 OR logo_checked = 0))
                 OR (type = 'show' AND logo_checked = 0))
            AND tmdb_id NOT GLOB ?
          ORDER BY id`,
      )
      .all(`${LOCAL}*`)
      .flatMap((row) =>
        isMatchItemType(row.type) ? [{ id: row.id, type: row.type, tmdbId: row.tmdb_id }] : [],
      )
  }

  /** Notes the saga a movie belongs to and TMDB's logo for it, or that it has neither. */
  saveMovieExtras({ itemId, saga, logo }: { itemId: number } & MovieExtras): void {
    this.db.transaction(() => {
      this.db
        .prepare(
          `UPDATE items SET saga_tmdb_id = ?, saga_name = ?, saga_checked = 1, logo_checked = 1
            WHERE id = ?`,
        )
        .run(saga?.tmdbId ?? null, saga?.name ?? null, itemId)
      this.images.setTmdbLogo({ itemId, logo })
    })()
  }

  /** Notes TMDB's logo for a show, or that it has none. */
  saveShowLogo({ itemId, logo }: { itemId: number; logo: string | null }): void {
    this.db.transaction(() => {
      this.db.prepare('UPDATE items SET logo_checked = 1 WHERE id = ?').run(itemId)
      this.images.setTmdbLogo({ itemId, logo })
    })()
  }

  /** An item's page, apart from its files, its children, the AI note and its favourite mark, which the caller adds. */
  details(id: number): Omit<ItemDetails, 'versions' | 'children' | 'aiMatch' | 'favourite'> | null {
    const row = this.db.prepare<[number], ItemRow>('SELECT * FROM shown_items WHERE id = ?').get(id)
    const summary = this.summaries([id]).get(id)
    if (!row || !summary) return null
    return {
      ...summary,
      tmdbId: row.tmdb_id,
      imdbId: row.imdb_id,
      originalTitle: row.original_title,
      tagline: row.tagline,
      summary: row.summary,
      contentRating: row.content_rating,
      released: row.released,
      ended: row.ended,
      runtime: row.runtime,
      studio: row.studio,
      genres: genresOf(row.genres),
      // An episode has a still where the others have a backdrop.
      backdropVersion:
        this.images
          .versions({
            ids: [id],
            kind:
              row.type === ITEM_TYPES.episode ? ITEM_IMAGE_KINDS.still : ITEM_IMAGE_KINDS.backdrop,
          })
          .get(id) ?? null,
      logoVersion: this.images.versions({ ids: [id], kind: ITEM_IMAGE_KINDS.logo }).get(id) ?? null,
      credits: this.credits(id),
      reviews: this.reviews(id),
    }
  }

  /** An item's reviews by TMDB members, newest first, at most ten. */
  reviews(itemId: number): Review[] {
    return this.db
      .prepare<
        [number],
        {
          id: number
          author: string
          avatar: string | null
          rating: number | null
          content: string
          url: string
          written_at: string
        }
      >(
        `SELECT id, author, avatar, rating, content, url, written_at FROM reviews
          WHERE item_id = ? ORDER BY written_at DESC, id DESC LIMIT 10`,
      )
      .all(itemId)
      .map((row) => ({
        id: row.id,
        author: row.author,
        avatarVersion: row.avatar == null ? null : versionOf(`tmdb:${row.avatar}`),
        rating: row.rating,
        content: row.content,
        url: row.url,
        writtenAt: row.written_at,
      }))
  }

  /** A reviewer's avatar path on TMDB, or null. */
  reviewAvatar(reviewId: number): string | null {
    return (
      this.db
        .prepare<[number], { avatar: string | null }>('SELECT avatar FROM reviews WHERE id = ?')
        .get(reviewId)?.avatar ?? null
    )
  }

  /**
   * Stores what one provider answered for an item and notes when. The rows
   * it wrote before and no longer sends go; the others' rows stay, and an
   * MDBList score is never overwritten by OMDb's.
   */
  saveScores({
    itemId,
    provider,
    scores,
  }: {
    itemId: number
    provider: ScoreProvider
    scores: readonly ExternalScore[]
  }): void {
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
         WHERE ratings.provider = excluded.provider OR excluded.provider = 'mdblist'`,
      )
      scores.forEach((score) =>
        upsert.run(itemId, score.source, score.value, score.votes, provider),
      )
    })()
  }

  /** Movies and shows whose scores from `provider` are due, in the order they are fetched, as far as `limit` goes. */
  scoresDue({
    provider,
    before,
    limit,
  }: {
    provider: ScoreProvider
    before: string
    limit: number
  }): Array<ScoreTitle & { itemId: number }> {
    return this.db
      .prepare<
        { local: string; before: string; limit: number },
        { id: number; type: string; tmdb_id: string; imdb_id: string | null }
      >(
        `SELECT id, type, tmdb_id, imdb_id FROM items
          WHERE ${scoresDueWhere(provider)}
          ORDER BY ${SCORES_ORDER[provider]}
          LIMIT @limit`,
      )
      .all({ local: `${LOCAL}*`, before, limit })
      .flatMap((row) =>
        isMatchItemType(row.type)
          ? [{ itemId: row.id, type: row.type, tmdbId: row.tmdb_id, imdbId: row.imdb_id }]
          : [],
      )
  }

  /** Whether an item's scores from `provider` are still due, by the rule `scoresDue` lists them by. */
  isScoreDue({
    itemId,
    provider,
    before,
  }: {
    itemId: number
    provider: ScoreProvider
    before: string
  }): boolean {
    return !!this.db
      .prepare<{ id: number; local: string; before: string }, { id: number }>(
        `SELECT id FROM items WHERE id = @id AND ${scoresDueWhere(provider)}`,
      )
      .get({ id: itemId, local: `${LOCAL}*`, before })
  }

  /** A person's page: the movies and shows on disk they are credited on, newest first. */
  person(id: number): StoredPerson | null {
    const row = this.db
      .prepare<[number], { id: number; tmdb_id: string; name: string; photo: string | null }>(
        'SELECT id, tmdb_id, name, photo FROM people WHERE id = ?',
      )
      .get(id)
    if (!row) return null
    const credits = this.db
      .prepare<
        [number, number],
        {
          item_id: number
          tmdb_id: string
          released: string | null
          job: string
          role: string | null
        }
      >(
        `WITH RECURSIVE ${under('SELECT item_id, item_id FROM credits WHERE person_id = ?')}
         SELECT c.item_id, i.tmdb_id, i.released, c.job, c.role
           FROM credits c JOIN items i ON i.id = c.item_id
          WHERE c.person_id = ? AND i.type IN ('movie', 'show')
            AND c.item_id IN (SELECT u.root FROM under u JOIN media_items mi ON mi.item_id = u.id)
          ORDER BY i.released DESC, i.title`,
      )
      .all(id, id)
    const summaries = this.summaries(credits.map((credit) => credit.item_id))
    return {
      id: row.id,
      tmdbId: row.tmdb_id,
      name: row.name,
      photoVersion: photoVersionOf(row.photo),
      credits: credits.flatMap((credit) => {
        const item = summaries.get(credit.item_id)
        return item && isCreditJob(credit.job)
          ? [
              {
                item,
                job: credit.job,
                role: credit.role,
                tmdbId: credit.tmdb_id,
                released: credit.released,
              },
            ]
          : []
      }),
    }
  }

  /** An item's credits in page order. */
  credits(itemId: number): Credit[] {
    return this.db
      .prepare<
        [number],
        { person_id: number; name: string; job: string; role: string | null; photo: string | null }
      >(
        `SELECT c.person_id, p.name, c.job, c.role, p.photo
           FROM credits c JOIN people p ON p.id = c.person_id
          WHERE c.item_id = ?
          ORDER BY c.position`,
      )
      .all(itemId)
      .flatMap((row): Credit[] =>
        isCreditJob(row.job)
          ? [
              {
                personId: row.person_id,
                name: row.name,
                job: row.job,
                role: row.role,
                photoVersion: photoVersionOf(row.photo),
              },
            ]
          : [],
      )
  }

  /** A person's photo path on TMDB, or null. */
  photo(personId: number): string | null {
    return (
      this.db
        .prepare<[number], { photo: string | null }>('SELECT photo FROM people WHERE id = ?')
        .get(personId)?.photo ?? null
    )
  }

  /**
   * Points each file at its items, replacing whatever it pointed at. A file
   * matched to another movie leaves its split behind, as that split was of
   * the old movie's cards; one matched to the same item again keeps it.
   */
  link({ mediaIds, itemIds }: { mediaIds: readonly number[]; itemIds: readonly number[] }): void {
    this.db.transaction(() => {
      const unsplit = this.db.prepare<{ mediaId: number; itemIds: string }>(
        `UPDATE media SET split = NULL
          WHERE id = @mediaId AND split IS NOT NULL
            AND NOT EXISTS (SELECT 1 FROM media_items
                             WHERE media_id = @mediaId
                               AND item_id IN (SELECT value FROM json_each(@itemIds)))`,
      )
      const clear = this.db.prepare('DELETE FROM media_items WHERE media_id = ?')
      const insert = this.db.prepare(
        'INSERT OR IGNORE INTO media_items (media_id, item_id) VALUES (?, ?)',
      )
      const linked = JSON.stringify(itemIds)
      mediaIds.forEach((mediaId) => {
        unsplit.run({ mediaId, itemIds: linked })
        clear.run(mediaId)
        itemIds.forEach((itemId) => insert.run(mediaId, itemId))
      })
    })()
  }

  unlink(mediaIds: readonly number[]): void {
    this.db
      .prepare('DELETE FROM media_items WHERE media_id IN (SELECT value FROM json_each(?))')
      .run(JSON.stringify(mediaIds))
  }

  /**
   * Items of `type` fetched before `before`, or before `recentBefore` when
   * released after `releasedAfter` or, for a show, while it still airs.
   */
  stale({
    type,
    before,
    recentBefore,
    releasedAfter,
  }: {
    type: ItemType
    before: string
    recentBefore: string
    releasedAfter: string
  }): Array<{ id: number; tmdbId: string }> {
    return this.db
      .prepare<[string, string, string, string], { id: number; tmdb_id: string }>(
        `SELECT id, tmdb_id FROM items
          WHERE type = ? AND (fetched_at < ?
                              OR (fetched_at < ? AND (released >= ? OR (type = 'show' AND ended IS NULL))))
          ORDER BY fetched_at`,
      )
      .all(type, before, recentBefore, releasedAfter)
      .map((row) => ({ id: row.id, tmdbId: row.tmdb_id }))
  }

  remove(id: number): void {
    this.db.prepare('DELETE FROM items WHERE id = ?').run(id)
  }

  /** The libraries holding a file of the item, or of any season or episode under it. */
  librariesHolding(itemId: number): number[] {
    return this.librariesHoldingEach([itemId]).get(itemId) ?? []
  }

  /**
   * `librariesHolding` for each item at once; an item no library holds is
   * left out. The CROSS JOINs walk down from the items to their files: for
   * one item, SQLite would rather read every file in library order for the
   * DISTINCT, a hundredth of a second each time on a real library.
   */
  librariesHoldingEach(itemIds: readonly number[]): Map<number, number[]> {
    if (itemIds.length === 0) return new Map()
    return this.db
      .prepare<[string], { root: number; library_id: number }>(
        `WITH RECURSIVE ${under('SELECT value, value FROM json_each(?)')}
         SELECT DISTINCT u.root, m.library_id FROM under u
           CROSS JOIN media_items mi ON mi.item_id = u.id
           CROSS JOIN media m ON m.id = mi.media_id`,
      )
      .all(JSON.stringify([...new Set(itemIds)]))
      .reduce(
        (byItem, row) => byItem.set(row.root, [...(byItem.get(row.root) ?? []), row.library_id]),
        new Map<number, number[]>(),
      )
  }

  /**
   * Removes movies with no file, shows and seasons with nothing under them,
   * and people left with no credits, but for those whose filmography was
   * fetched in the last 180 days, so a person someone looked at keeps their
   * page. Returns what is still stored, for the image cache's sweep.
   */
  clearUp(): { tmdbPaths: Set<string>; itemIds: Set<number> } {
    this.db.transaction(() => {
      this.db.exec(`
        DELETE FROM items WHERE type IN ('movie', 'episode')
          AND id NOT IN (SELECT item_id FROM media_items);
        DELETE FROM items WHERE type = 'season'
          AND id NOT IN (SELECT parent_id FROM items WHERE parent_id IS NOT NULL)
          AND id NOT IN (SELECT item_id FROM media_items);
        DELETE FROM items WHERE type = 'show'
          AND id NOT IN (SELECT parent_id FROM items WHERE parent_id IS NOT NULL)
          AND id NOT IN (SELECT item_id FROM media_items);
      `)
      this.db
        .prepare<[string]>(
          `DELETE FROM people WHERE id NOT IN (SELECT person_id FROM credits)
             AND (filmography_fetched_at IS NULL OR filmography_fetched_at < ?)`,
        )
        .run(new Date(Date.now() - FILMOGRAPHY_KEPT_DAYS * DAY_MS).toISOString())
    })()
    const tmdbPaths = new Set(
      this.db
        .prepare<[], { ref: string }>(
          `SELECT ref FROM item_images WHERE source IN ('tmdb', 'chosen')
           UNION SELECT photo AS ref FROM people WHERE photo IS NOT NULL`,
        )
        .all()
        .map((row) => row.ref),
    )
    const itemIds = new Set(
      this.db
        .prepare<[], { id: number }>('SELECT id FROM items')
        .all()
        .map((row) => row.id),
    )
    return { tmdbPaths, itemIds }
  }
}
