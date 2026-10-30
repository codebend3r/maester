import { Inject, Injectable } from '@nestjs/common'
import {
  type Credit,
  isCreditJob,
  isItemType,
  isMatchItemType,
  isStringArray,
  ITEM_IMAGE_KINDS,
  ITEM_TYPES,
  type ItemDetails,
  type ItemSummary,
  type LibraryPictures,
  type ItemType,
  type MatchItemType,
  type PersonDetails,
  type Review,
  sortTitle,
} from '@raven/core'
import type Sqlite from 'better-sqlite3'
import { DatabaseService } from '@/db/database'
import { parseJsonAs } from '@/db/json'
import { ItemImagesRepository, lineOf } from '@/metadata/itemImagesRepository'
import { PictureVersions } from '@/metadata/pictureVersions'
import { LOCAL } from '@/metadata/localItems'
import { ScoresRepository } from '@/metadata/scoresRepository'
import type { FetchedItem, FetchedSaga, MovieExtras } from '@/metadata/tmdbShapes'

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
  released: string | null
  number: number | null
  parent_number: number | null
  show_id: number | null
  show_title: string | null
}

/** A season's own number, or an episode's season's; null for anything else. */
const seasonOf = (row: SummaryRow): number | null => {
  if (row.type === ITEM_TYPES.season) return row.number
  return row.type === ITEM_TYPES.episode ? row.parent_number : null
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

const DAY_MS = 24 * 60 * 60 * 1000

/** A person whose filmography was fetched this recently keeps their id with no credits left. */
const FILMOGRAPHY_KEPT_DAYS = 180

const genresOf = (json: string): string[] => parseJsonAs({ json, guard: isStringArray }) ?? []

type MetadataRepositoryFindProps = {
  type: ItemType
  tmdbId: string
}

type MetadataRepositoryChildProps = {
  parentId: number
  number: number
}

type MetadataRepositorySaveProps = { item: FetchedItem; parentId?: number | null }

type MetadataRepositorySaveSeasonProps = {
  showId: number
  number: number
  season: FetchedItem
  episodes: readonly FetchedItem[]
}

type MetadataRepositorySaveShowLogoProps = { itemId: number; logo: string | null }

type MetadataRepositoryLinkProps = { mediaIds: readonly number[]; itemIds: readonly number[] }

type MetadataRepositoryStaleProps = {
  type: ItemType
  before: string
  recentBefore: string
  releasedAfter: string
}

type MetadataRepositorySummariesProps = {
  ids: readonly number[]
  /** The library whose cards these are; null for none, which shows no library's choice. */
  libraryId: number | null
}

type MetadataRepositoryPosterItemsProps = MetadataRepositorySummariesProps

type MetadataRepositoryPicturesProps = {
  id: number
  type: ItemType
  libraryId: number | null
}

type MetadataRepositoryLibraryPicturesProps = { id: number; libraryIds: readonly number[] }

/** Movies, shows, seasons and episodes as TMDB describes them, with their people and pictures; their scores are `ScoresRepository`'s. */
@Injectable()
export class MetadataRepository {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(ItemImagesRepository) private readonly images: ItemImagesRepository,
    @Inject(PictureVersions) private readonly pictureVersions: PictureVersions,
    @Inject(ScoresRepository) private readonly scores: ScoresRepository,
  ) {}

  private get db(): Sqlite.Database {
    return this.database.db
  }

  /** The stored item for a TMDB id, and when it was fetched. */
  find({ type, tmdbId }: MetadataRepositoryFindProps): { id: number; fetchedAt: string } | null {
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
    const summaries = this.summaries({ ids, libraryId: null })
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
    const stills = this.images.versions({ ids, kind: ITEM_IMAGE_KINDS.still, libraryId: null })
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
  }: MetadataRepositoryChildProps): { id: number; tmdbId: string; fetchedAt: string } | null {
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
  save({ item, parentId = null }: MetadataRepositorySaveProps): number {
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

      this.scores.saveTmdbRating({ itemId: id, rating: item.rating })

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
  saveSeason({ showId, number, season, episodes }: MetadataRepositorySaveSeasonProps): {
    id: number
    number: number
    episodes: Map<number, number>
  } {
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

  /**
   * What a card needs for each item, keyed by id, with the pictures
   * `libraryId`'s cards show; with no library, the item's own.
   */
  summaries({ ids, libraryId }: MetadataRepositorySummariesProps): Map<number, ItemSummary> {
    if (ids.length === 0) return new Map()
    const unique = [...new Set(ids)]
    const ratings = this.scores.ratingsFor(unique)
    const rows = this.db
      .prepare<[string], SummaryRow>(
        `SELECT i.id, i.type, i.title, i.year, i.released, i.number,
                p.number AS parent_number,
                CASE i.type WHEN 'season' THEN p.id WHEN 'episode' THEN g.id END AS show_id,
                CASE i.type WHEN 'season' THEN p.title WHEN 'episode' THEN g.title END AS show_title
           FROM shown_items i
           LEFT JOIN shown_items p ON p.id = i.parent_id
           LEFT JOIN shown_items g ON g.id = p.parent_id
          WHERE i.id IN (SELECT value FROM json_each(?))`,
      )
      .all(JSON.stringify(unique))
    const posters = this.images.versions({ ids: unique, kind: ITEM_IMAGE_KINDS.poster, libraryId })
    const backdrops = this.images.versions({
      ids: unique,
      kind: ITEM_IMAGE_KINDS.backdrop,
      libraryId,
    })
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
              season: seasonOf(row),
              episode: row.type === ITEM_TYPES.episode ? row.number : null,
              posterVersion: posters.get(row.id) ?? null,
              backdropVersion: backdrops.get(row.id) ?? null,
              ratings: ratings.get(row.id) ?? [],
              released: row.released,
            },
          ],
        ]
      }),
    )
  }

  /**
   * The item whose poster stands for each item: its own, else its parent's,
   * else its grandparent's, so an episode shows its season's poster and a
   * season without one its show's, as `libraryId`'s cards show them. An
   * item with none up the line is left out.
   */
  posterItems({ ids, libraryId }: MetadataRepositoryPosterItemsProps): Map<number, ItemSummary> {
    if (ids.length === 0) return new Map()
    const lines = this.images.lines(ids)
    const summaries = this.summaries({ ids: lines.flatMap(lineOf), libraryId })
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
  saveShowLogo({ itemId, logo }: MetadataRepositorySaveShowLogoProps): void {
    this.db.transaction(() => {
      this.db.prepare('UPDATE items SET logo_checked = 1 WHERE id = ?').run(itemId)
      this.images.setTmdbLogo({ itemId, logo })
    })()
  }

  /** Each item's summary, else its tagline, as the hero reads it under the title; null where it has neither. */
  blurbs(ids: readonly number[]): Map<number, string | null> {
    if (ids.length === 0) return new Map()
    return new Map(
      this.db
        .prepare<[string], { id: number; blurb: string | null }>(
          `SELECT id, COALESCE(NULLIF(summary, ''), NULLIF(tagline, '')) AS blurb
             FROM shown_items WHERE id IN (SELECT value FROM json_each(?))`,
        )
        .all(JSON.stringify([...new Set(ids)]))
        .map((row) => [row.id, row.blurb]),
    )
  }

  /**
   * An item's page, apart from its files, its children, the AI note, its
   * favourite mark and each library's pictures, which the caller adds.
   */
  details(
    id: number,
  ): Omit<
    ItemDetails,
    'versions' | 'children' | 'aiMatch' | 'favourite' | 'libraryPictures'
  > | null {
    const row = this.db.prepare<[number], ItemRow>('SELECT * FROM shown_items WHERE id = ?').get(id)
    const summary = this.summaries({ ids: [id], libraryId: null }).get(id)
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
      ...this.pictures({ id, type: summary.type, libraryId: null }),
      credits: this.credits(id),
      reviews: this.reviews(id),
    }
  }

  /**
   * The versions of the pictures an item's page shows, as `libraryId`
   * shows them; with no library, its own. An episode has a still where the
   * others have a backdrop.
   */
  private pictures({
    id,
    type,
    libraryId,
  }: MetadataRepositoryPicturesProps): Pick<ItemDetails, 'backdropVersion' | 'logoVersion'> {
    const backdrop =
      type === ITEM_TYPES.episode ? ITEM_IMAGE_KINDS.still : ITEM_IMAGE_KINDS.backdrop
    return {
      backdropVersion:
        this.images.versions({ ids: [id], kind: backdrop, libraryId }).get(id) ?? null,
      logoVersion:
        this.images.versions({ ids: [id], kind: ITEM_IMAGE_KINDS.logo, libraryId }).get(id) ?? null,
    }
  }

  /** The pictures an item's page shows in each of `libraryIds`, which can each choose their own. */
  libraryPictures({ id, libraryIds }: MetadataRepositoryLibraryPicturesProps): LibraryPictures[] {
    const type = this.get(id)?.type ?? null
    if (type == null) return []
    return libraryIds.map((libraryId) => ({
      libraryId,
      posterVersion:
        this.images.versions({ ids: [id], kind: ITEM_IMAGE_KINDS.poster, libraryId }).get(id) ??
        null,
      ...this.pictures({ id, type, libraryId }),
    }))
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
        avatarVersion: this.pictureVersions.avatar({ id: row.id, avatar: row.avatar }),
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
    const summaries = this.summaries({
      ids: credits.map((credit) => credit.item_id),
      libraryId: null,
    })
    return {
      id: row.id,
      tmdbId: row.tmdb_id,
      name: row.name,
      photoVersion: this.pictureVersions.photo({ id: row.id, photo: row.photo }),
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
                photoVersion: this.pictureVersions.photo({ id: row.person_id, photo: row.photo }),
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
  link({ mediaIds, itemIds }: MetadataRepositoryLinkProps): void {
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
  }: MetadataRepositoryStaleProps): Array<{ id: number; tmdbId: string }> {
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
           UNION SELECT ref FROM library_item_images
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
