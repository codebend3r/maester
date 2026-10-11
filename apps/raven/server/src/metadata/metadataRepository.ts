import { createHash } from 'node:crypto'
import { Inject, Injectable } from '@nestjs/common'
import {
  type Credit,
  isCreditJob,
  isItemType,
  isRatingSource,
  isStringArray,
  type ItemDetails,
  type ItemImageKind,
  type ItemSummary,
  type ItemType,
  type PersonDetails,
  type Rating,
  type RatingSource,
  type Review,
  sortTitle,
} from '@raven/core'
import type Sqlite from 'better-sqlite3'
import { DatabaseService } from '@/db/database'
import type { OmdbScore } from '@/metadata/omdbClient'
import type { FetchedItem } from '@/metadata/tmdbClient'

/** A short stable tag for a picture's source, so its URL changes exactly when the picture does. */
export const versionOf = (ref: string): string =>
  createHash('sha1').update(ref).digest('base64url').slice(0, 11)

/** `chosen` is what Edit images picked, a TMDB path; it beats a local picture, which beats TMDB's own. */
export type ImageSource = 'tmdb' | 'local' | 'chosen'

/** Where an item's picture comes from: a file beside the media wins over TMDB's. */
export type ImageRef = { source: ImageSource; ref: string }

/** Rotten Tomatoes and Metacritic are critics; TMDB and IMDb are audiences. */
const RATING_KINDS: Record<RatingSource, Rating['kind']> = {
  tmdb: 'audience',
  imdb: 'audience',
  rottenTomatoes: 'critic',
  metacritic: 'critic',
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

/** The picture each item shows for `kind`: the chosen one first, then local, then TMDB's. */
const IMAGE_REFS = `
  SELECT item_id, source, ref FROM item_images
   WHERE kind = ? AND item_id IN (SELECT value FROM json_each(?))
   ORDER BY item_id, CASE source WHEN 'chosen' THEN 0 WHEN 'local' THEN 1 ELSE 2 END`

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

const toImageSource = (source: string): ImageSource =>
  source === 'local' ? 'local' : source === 'chosen' ? 'chosen' : 'tmdb'

const genresOf = (json: string): string[] => {
  try {
    const parsed: unknown = JSON.parse(json)
    return isStringArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

/** Movies, shows, seasons and episodes as TMDB describes them, with their people, scores and pictures. */
@Injectable()
export class MetadataRepository {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

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
                              imdb_id, tvdb_id, fetched_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT (type, tmdb_id) DO UPDATE SET
             parent_id = excluded.parent_id, number = excluded.number, title = excluded.title,
             original_title = excluded.original_title, sort_title = excluded.sort_title,
             year = excluded.year, released = excluded.released, ended = excluded.ended,
             summary = excluded.summary, tagline = excluded.tagline,
             content_rating = excluded.content_rating, runtime = excluded.runtime,
             studio = excluded.studio, genres = excluded.genres, imdb_id = excluded.imdb_id,
             tvdb_id = excluded.tvdb_id, fetched_at = excluded.fetched_at
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

  /** Replaces an item's pictures from beside the media; a kind left out has none. */
  setLocalImages({
    itemId,
    images,
  }: {
    itemId: number
    images: Partial<Record<ItemImageKind, string>>
  }): void {
    this.db.transaction(() => {
      this.db.prepare(`DELETE FROM item_images WHERE item_id = ? AND source = 'local'`).run(itemId)
      const insert = this.db.prepare(
        `INSERT INTO item_images (item_id, kind, source, ref) VALUES (?, ?, 'local', ?)`,
      )
      Object.entries(images).forEach(([kind, ref]) => insert.run(itemId, kind, ref))
    })()
  }

  /** The picture an item shows for `kind`, or null when it has none. */
  image({ itemId, kind }: { itemId: number; kind: ItemImageKind }): ImageRef | null {
    const row = this.db
      .prepare<[string, string], { item_id: number; source: string; ref: string }>(IMAGE_REFS)
      .get(kind, JSON.stringify([itemId]))
    if (!row) return null
    return { source: toImageSource(row.source), ref: row.ref }
  }

  /** The picture of `source` an item holds for `kind`, whatever it shows. */
  imageFrom({
    itemId,
    kind,
    source,
  }: {
    itemId: number
    kind: ItemImageKind
    source: ImageSource
  }): string | null {
    return (
      this.db
        .prepare<[number, string, string], { ref: string }>(
          `SELECT ref FROM item_images WHERE item_id = ? AND kind = ? AND source = ?`,
        )
        .get(itemId, kind, source)?.ref ?? null
    )
  }

  /** Edit images: the item shows TMDB's picture at `ref` for `kind` from now on, or, for null, whatever it would by itself. */
  chooseImage({
    itemId,
    kind,
    ref,
  }: {
    itemId: number
    kind: ItemImageKind
    ref: string | null
  }): void {
    this.db.transaction(() => {
      this.db
        .prepare(`DELETE FROM item_images WHERE item_id = ? AND kind = ? AND source = 'chosen'`)
        .run(itemId, kind)
      if (ref != null) {
        this.db
          .prepare(
            `INSERT INTO item_images (item_id, kind, source, ref) VALUES (?, ?, 'chosen', ?)`,
          )
          .run(itemId, kind, ref)
      }
    })()
  }

  /** An item's TMDB picture for `kind`, whatever is beside the media. */
  tmdbImage({ itemId, kind }: { itemId: number; kind: ItemImageKind }): string | null {
    return (
      this.db
        .prepare<[number, string], { ref: string }>(
          `SELECT ref FROM item_images WHERE item_id = ? AND kind = ? AND source = 'tmdb'`,
        )
        .get(itemId, kind)?.ref ?? null
    )
  }

  private versions({
    ids,
    kind,
  }: {
    ids: readonly number[]
    kind: ItemImageKind
  }): Map<number, string> {
    const rows = this.db
      .prepare<[string, string], { item_id: number; source: string; ref: string }>(IMAGE_REFS)
      .all(kind, JSON.stringify(ids))
    return rows.reduce(
      (versions, row) =>
        versions.has(row.item_id)
          ? versions
          : versions.set(row.item_id, versionOf(`${row.source}:${row.ref}`)),
      new Map<number, string>(),
    )
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
          kind: RATING_KINDS[row.source],
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
    const posters = this.versions({ ids: unique, kind: 'poster' })
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
                row.type === 'season'
                  ? row.number
                  : row.type === 'episode'
                    ? row.parent_number
                    : null,
              episode: row.type === 'episode' ? row.number : null,
              posterVersion: posters.get(row.id) ?? null,
              ratings: ratings.get(row.id) ?? [],
            },
          ],
        ]
      }),
    )
  }

  /** An item's page, apart from its files and children, which the caller adds. */
  details(id: number): Omit<ItemDetails, 'versions' | 'children'> | null {
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
        this.versions({ ids: [id], kind: row.type === 'episode' ? 'still' : 'backdrop' }).get(id) ??
        null,
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

  /** Replaces an item's scores from OMDb, and notes when they were fetched. */
  saveScores({ itemId, scores }: { itemId: number; scores: readonly OmdbScore[] }): void {
    this.db.transaction(() => {
      this.db
        .prepare(
          `DELETE FROM ratings WHERE item_id = ? AND source IN ('imdb', 'rottenTomatoes', 'metacritic')`,
        )
        .run(itemId)
      const insert = this.db.prepare(
        'INSERT OR REPLACE INTO ratings (item_id, source, value, votes) VALUES (?, ?, ?, NULL)',
      )
      scores.forEach((score) => insert.run(itemId, score.source, score.value))
      this.db
        .prepare('UPDATE items SET omdb_fetched_at = ? WHERE id = ?')
        .run(new Date().toISOString(), itemId)
    })()
  }

  /** Movies and shows with an IMDb id whose OMDb scores are missing or older than `before`, never fetched first. */
  needingScores({
    before,
    limit,
  }: {
    before: string
    limit: number
  }): Array<{ id: number; imdbId: string }> {
    return this.db
      .prepare<[string, number], { id: number; imdb_id: string }>(
        `SELECT id, imdb_id FROM items
          WHERE type IN ('movie', 'show') AND imdb_id IS NOT NULL
            AND (omdb_fetched_at IS NULL OR omdb_fetched_at < ?)
          ORDER BY omdb_fetched_at IS NOT NULL, fetched_at DESC
          LIMIT ?`,
      )
      .all(before, limit)
      .map((row) => ({ id: row.id, imdbId: row.imdb_id }))
  }

  /** A person's page: the movies and shows on disk they are credited on, newest first. */
  person(id: number): PersonDetails | null {
    const row = this.db
      .prepare<[number], { id: number; name: string; photo: string | null }>(
        'SELECT id, name, photo FROM people WHERE id = ?',
      )
      .get(id)
    if (!row) return null
    const credits = this.db
      .prepare<[number, number], { item_id: number; job: string; role: string | null }>(
        `WITH RECURSIVE ${under('SELECT item_id, item_id FROM credits WHERE person_id = ?')}
         SELECT c.item_id, c.job, c.role
           FROM credits c JOIN items i ON i.id = c.item_id
          WHERE c.person_id = ? AND i.type IN ('movie', 'show')
            AND c.item_id IN (SELECT u.root FROM under u JOIN media_items mi ON mi.item_id = u.id)
          ORDER BY i.released DESC, i.title`,
      )
      .all(id, id)
    const summaries = this.summaries(credits.map((credit) => credit.item_id))
    return {
      id: row.id,
      name: row.name,
      photoVersion: row.photo == null ? null : versionOf(`tmdb:${row.photo}`),
      credits: credits.flatMap((credit) => {
        const item = summaries.get(credit.item_id)
        return item && isCreditJob(credit.job) ? [{ item, job: credit.job, role: credit.role }] : []
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
                photoVersion: row.photo == null ? null : versionOf(`tmdb:${row.photo}`),
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

  /** Points each file at its items, replacing whatever it pointed at. */
  link({ mediaIds, itemIds }: { mediaIds: readonly number[]; itemIds: readonly number[] }): void {
    this.db.transaction(() => {
      const clear = this.db.prepare('DELETE FROM media_items WHERE media_id = ?')
      const insert = this.db.prepare(
        'INSERT OR IGNORE INTO media_items (media_id, item_id) VALUES (?, ?)',
      )
      mediaIds.forEach((mediaId) => {
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
    return this.db
      .prepare<[number], { library_id: number }>(
        `WITH RECURSIVE ${under('SELECT id, id FROM items WHERE id = ?')}
         SELECT DISTINCT m.library_id FROM under u
           JOIN media_items mi ON mi.item_id = u.id
           JOIN media m ON m.id = mi.media_id`,
      )
      .all(itemId)
      .map((row) => row.library_id)
  }

  /**
   * Removes movies with no file, shows and seasons with nothing under them,
   * and people left with no credits. Returns what is still stored, for the
   * image cache's sweep.
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
        DELETE FROM people WHERE id NOT IN (SELECT person_id FROM credits);
      `)
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
