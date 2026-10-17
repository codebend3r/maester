import { Inject, Injectable } from '@nestjs/common'
import {
  DEFAULT_SAGA_BACKDROP,
  type LibraryBackdrop,
  MEDIA_SORTS,
  type MediaItem,
  type MediaSort,
  type PosterEntry,
  type Saga,
  type ShowEntry,
  isMatchState,
  isThumbnailState,
  readCut,
  readRelease,
} from '@raven/core'
import { DatabaseService } from '@/db/database'
import {
  BEST_FIRST,
  FIRST_ITEM,
  cardWatched,
  fileWatched,
  likePattern,
  score,
} from '@/media/mediaSql'
import { SagaBackdrops } from '@/media/sagaBackdrops'
import { shuffle } from '@/media/shuffle'
import { ItemImagesRepository } from '@/metadata/itemImagesRepository'
import { MetadataRepository } from '@/metadata/metadataRepository'

/** A media row as the listings read it; the path is selected with the rest but never leaves here. */
type MediaRow = {
  id: number
  library_id: number
  file_name: string
  folder: string
  title: string
  container: string
  size: number
  mtime_ms: number
  duration: number | null
  width: number | null
  height: number | null
  video_codec: string | null
  video_bit_depth: number | null
  hdr: number
  audio_codec: string | null
  audio_channels: number | null
  bitrate: number | null
  thumbnail: string
  added_at: string
  changed_at: string
  year: number | null
  edition: string | null
  match: string
  position: number | null
  favourited_at: string | null
  item_id: number | null
  item_type: string | null
  item_tmdb_title: string | null
  item_tmdb_original_title: string | null
  split: string | null
  versions: number
  watched: number
}

/**
 * A saved spot counts only while its library saves progress; turned off, it
 * is kept but not shown. A file holding two episodes takes the first as its
 * item. `versions` counts the files in the library on the same movie's card,
 * which its `split` names; `IS` holds two NULLs equal, so the files on the
 * movie's own card count each other. The CROSS JOIN makes that count start
 * from the movie's files: left to choose, SQLite walked every file in the
 * library for each card, seconds for a few thousand movies. TMDB's own
 * titles come along for telling a split file's cut. `watched` is the card's,
 * not the file's.
 */
const SELECT_COLUMNS = `
  SELECT m.*, CASE WHEN l.save_progress = 1 THEN p.position END AS position,
         f.added_at AS favourited_at,
         i.id AS item_id, i.type AS item_type, i.title AS item_title,
         i.original_title AS item_original_title, i.sort_title AS item_sort_title,
         i.year AS item_year, t.title AS item_tmdb_title,
         t.original_title AS item_tmdb_original_title,
         CASE WHEN i.type = 'movie'
              THEN (SELECT COUNT(*) FROM media_items x CROSS JOIN media y ON y.id = x.media_id
                     WHERE x.item_id = i.id AND y.library_id = m.library_id
                       AND y.split IS m.split)
              ELSE 1 END AS versions,
         ${cardWatched({ file: 'm', item: 'i' })} AS watched,
         ${score({ item: 'i.id', source: 'l.ratings_source' })} AS score`

const FROM_MEDIA = `
    FROM media m
    JOIN libraries l ON l.id = m.library_id
    LEFT JOIN playback_progress p ON p.media_id = m.id
    LEFT JOIN favourites f ON f.media_id = m.id
    LEFT JOIN ${FIRST_ITEM}
    LEFT JOIN shown_items i ON i.id = mi.item_id
    LEFT JOIN items t ON t.id = mi.item_id`

const SELECT_MEDIA = `${SELECT_COLUMNS}${FROM_MEDIA}`

/**
 * What sets a split movie file's card apart: the cut Smart split apart
 * gave it, else the cut or release its name reads as. Null for a file on
 * its movie's own card, and for anything but a movie.
 */
const variantOf = (row: MediaRow): string | null => {
  if (row.item_type !== 'movie' || row.split == null) return null
  if (row.split.startsWith('cut:')) return row.split.slice('cut:'.length)
  const titles = [row.item_tmdb_title, row.item_tmdb_original_title]
  return readCut({ fileName: row.file_name, titles })?.label ?? readRelease(row.file_name)
}

/** The client's view of a row, before its item's summary is attached: no path, no bookkeeping. */
const toItem = (row: MediaRow): MediaItem => ({
  id: row.id,
  libraryId: row.library_id,
  title: row.title,
  fileName: row.file_name,
  folder: row.folder,
  size: row.size,
  container: row.container,
  duration: row.duration,
  width: row.width,
  height: row.height,
  videoCodec: row.video_codec,
  videoBitDepth: row.video_bit_depth,
  hdr: row.hdr === 1,
  audioCodec: row.audio_codec,
  audioChannels: row.audio_channels,
  bitrate: row.bitrate,
  thumbnail: isThumbnailState(row.thumbnail) ? row.thumbnail : 'pending',
  thumbnailVersion: row.mtime_ms,
  position: row.position ?? 0,
  favourite: row.favourited_at != null,
  watched: row.watched === 1,
  addedAt: row.added_at,
  changedAt: row.changed_at,
  match: isMatchState(row.match) ? row.match : 'pending',
  year: row.year,
  edition: row.edition,
  item: null,
  versions: row.versions,
  variant: variantOf(row),
  card: row.item_type === 'movie' ? row.split : null,
})

/** A show in a TV library's listing, before its next episode is looked up. */
type ShowRow = {
  id: number
  ended: string | null
  episodes: number
  watched_episodes: number
  added_at: string
  bitrate: number | null
}

const SHOW_BY_TITLE = 'sh.sort_title COLLATE NOCASE, sh.id'

/**
 * A show's listing order: by its files' mean bitrate for the bitrate sorts,
 * and by title for the others that only mean something per file.
 */
const SHOW_ORDER_BY: Record<MediaSort, string> = {
  title: SHOW_BY_TITLE,
  'title-desc': 'sh.sort_title COLLATE NOCASE DESC, sh.id DESC',
  added: 'added_at DESC, sh.id DESC',
  oldest: 'added_at, sh.id',
  changed: 'changed_at DESC, sh.id DESC',
  'changed-old': 'changed_at, sh.id',
  largest: SHOW_BY_TITLE,
  smallest: SHOW_BY_TITLE,
  'bitrate-high': `bitrate IS NULL, bitrate DESC, ${SHOW_BY_TITLE}`,
  'bitrate-low': `bitrate IS NULL, bitrate, ${SHOW_BY_TITLE}`,
  'resolution-high': SHOW_BY_TITLE,
  'resolution-low': SHOW_BY_TITLE,
  'year-new': `sh.year IS NULL, sh.year DESC, ${SHOW_BY_TITLE}`,
  'year-old': `sh.year IS NULL, sh.year, ${SHOW_BY_TITLE}`,
  'rating-high': `score IS NULL, score DESC, ${SHOW_BY_TITLE}`,
  'rating-low': `score IS NULL, score, ${SHOW_BY_TITLE}`,
  random: SHOW_BY_TITLE,
}

/** The files of a library that are episodes, with their show and numbers. */
const EPISODE_FILES = `
  SELECT m.id AS media_id, m.library_id, m.added_at, m.changed_at, m.bitrate, e.id AS episode_id,
         s.parent_id AS show_id, ${fileWatched('m')} AS watched
    FROM media m
    JOIN libraries l ON l.id = m.library_id
    JOIN media_items mi ON mi.media_id = m.id
    JOIN shown_items e ON e.id = mi.item_id AND e.type = 'episode'
    JOIN shown_items s ON s.id = e.parent_id
   WHERE m.library_id = ?`

const BY_TITLE = 'COALESCE(item_sort_title, title) COLLATE NOCASE, id'

/** SQLite reads a negative LIMIT as none. */
const NO_LIMIT = -1

/**
 * The LIMIT a listing reads with. A random sort deals from every row, so it
 * reads them all and is cut after the shuffle.
 */
const sqlLimit = ({ sort, limit }: { sort: MediaSort; limit: number | undefined }): number =>
  sort === MEDIA_SORTS.random ? NO_LIMIT : (limit ?? NO_LIMIT)

const YEAR = 'COALESCE(item_year, year)'

/**
 * ORDER BY for each sort, over the listing's columns. Ties fall back to
 * title. Bitrate, resolution and year are unknown for some files, and those
 * go last either way. Random lists by title here and is shuffled after.
 */
const ORDER_BY: Record<MediaSort, string> = {
  title: BY_TITLE,
  'title-desc': 'COALESCE(item_sort_title, title) COLLATE NOCASE DESC, id DESC',
  added: 'added_at DESC, id DESC',
  oldest: 'added_at, id',
  changed: 'changed_at DESC, id DESC',
  'changed-old': 'changed_at, id',
  largest: `size DESC, ${BY_TITLE}`,
  smallest: `size, ${BY_TITLE}`,
  'bitrate-high': `bitrate IS NULL, bitrate DESC, ${BY_TITLE}`,
  'bitrate-low': `bitrate IS NULL, bitrate, ${BY_TITLE}`,
  'resolution-high': `width * height IS NULL, width * height DESC, ${BY_TITLE}`,
  'resolution-low': `width * height IS NULL, width * height, ${BY_TITLE}`,
  'year-new': `${YEAR} IS NULL, ${YEAR} DESC, ${BY_TITLE}`,
  'year-old': `${YEAR} IS NULL, ${YEAR}, ${BY_TITLE}`,
  'rating-high': `score IS NULL, score DESC, ${BY_TITLE}`,
  'rating-low': `score IS NULL, score, ${BY_TITLE}`,
  random: BY_TITLE,
}

/**
 * The videos as a client sees them: listings, a show's next episode, an
 * item's files, favourites. Every answer is a `MediaItem`, which has no
 * path, so nothing read here can hand a client one. What the server needs
 * of a file itself, its path above all, is `MediaIndex`'s.
 */
@Injectable()
export class MediaRepository {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(MetadataRepository) private readonly metadata: MetadataRepository,
    @Inject(ItemImagesRepository) private readonly images: ItemImagesRepository,
    @Inject(SagaBackdrops) private readonly sagaBackdrops: SagaBackdrops,
  ) {}

  private get db() {
    return this.database.db
  }

  /** Items for rows, each with its item's summary attached. */
  private items(rows: readonly MediaRow[]): MediaItem[] {
    const summaries = this.metadata.summaries(
      rows.flatMap((row) => (row.item_id == null ? [] : [row.item_id])),
    )
    return rows.map((row) => ({
      ...toItem(row),
      item: row.item_id == null ? null : (summaries.get(row.item_id) ?? null),
    }))
  }

  /** The videos with these ids, in the order asked; one that is gone is left out. */
  getMany(ids: readonly number[]): MediaItem[] {
    if (ids.length === 0) return []
    const found = new Map(
      this.items(
        this.db
          .prepare<[string], MediaRow>(
            `${SELECT_MEDIA} WHERE m.id IN (SELECT value FROM json_each(?))`,
          )
          .all(JSON.stringify(ids)),
      ).map((item) => [item.id, item]),
    )
    return ids.flatMap((id) => found.get(id) ?? [])
  }

  get(id: number): MediaItem | null {
    return this.getMany([id])[0] ?? null
  }

  /**
   * A library's videos in `sort` order; `seed` decides a random one, and
   * `limit` keeps the first that many. A movie kept as several files is one
   * entry, its best file, with `versions` saying how many there are, unless
   * its files were split apart into a card each or one for each cut. Search
   * matches the file's title and its movie's.
   */
  list({
    libraryId,
    search = '',
    sort = 'title',
    seed = 0,
    limit,
  }: {
    libraryId: number
    search?: string
    sort?: MediaSort
    seed?: number
    limit?: number
  }): MediaItem[] {
    const pattern = likePattern(search.trim())
    const rows = this.db
      .prepare<[number, string, string, string, number], MediaRow>(
        `WITH listed AS (
           ${SELECT_COLUMNS},
                  ROW_NUMBER() OVER (
                    PARTITION BY CASE WHEN i.type = 'movie' THEN i.id || '|' || COALESCE(m.split, '')
                                      ELSE -m.id END
                    ORDER BY ${BEST_FIRST}) AS version_rank
           ${FROM_MEDIA}
            WHERE m.library_id = ?)
         SELECT * FROM listed
          WHERE version_rank = 1
            AND (title LIKE ? ESCAPE '\\' OR item_title LIKE ? ESCAPE '\\'
                 OR item_original_title LIKE ? ESCAPE '\\')
          ORDER BY ${ORDER_BY[sort]}
          LIMIT ?`,
      )
      .all(libraryId, pattern, pattern, pattern, sqlLimit({ sort, limit }))
    const items = this.items(rows)
    return sort === MEDIA_SORTS.random ? shuffle({ items, seed }).slice(0, limit) : items
  }

  /**
   * Each show's first episode not yet watched, by the measure of the library
   * holding the file (specials last, the best file of an episode first), as
   * show id to media id. An episode is watched when any of its files in
   * `libraryIds` is, so a watched 1080p hides its unwatched 720p. A show with
   * every episode watched has none.
   */
  private nextUnwatched({
    showIds,
    libraryIds,
  }: {
    showIds: readonly number[]
    libraryIds: readonly number[]
  }): Map<number, number> {
    const rows = this.db
      .prepare<[string, string], { show_id: number; media_id: number }>(
        `WITH files AS (
           SELECT s.parent_id AS show_id, m.id AS media_id, e.id AS episode_id,
                  s.number AS season_number, e.number AS episode_number,
                  COALESCE(m.width * m.height, 0) AS pixels,
                  ${fileWatched('m')} AS watched
             FROM media m
             JOIN libraries l ON l.id = m.library_id
             JOIN media_items mi ON mi.media_id = m.id
             JOIN shown_items e ON e.id = mi.item_id AND e.type = 'episode'
             JOIN shown_items s ON s.id = e.parent_id
            WHERE s.parent_id IN (SELECT value FROM json_each(?))
              AND m.library_id IN (SELECT value FROM json_each(?))),
         episodes AS (
           SELECT *, MAX(watched) OVER (PARTITION BY episode_id) AS episode_watched FROM files),
         ranked AS (
           SELECT show_id, media_id,
                  ROW_NUMBER() OVER (
                    PARTITION BY show_id
                    ORDER BY season_number = 0, season_number, episode_number, pixels DESC, media_id
                  ) AS rank
             FROM episodes
            WHERE episode_watched = 0)
         SELECT show_id, media_id FROM ranked WHERE rank = 1`,
      )
      .all(JSON.stringify(showIds), JSON.stringify(libraryIds))
    return new Map(rows.map((row) => [row.show_id, row.media_id]))
  }

  /**
   * A TV library as its shows: how many episodes each has on disk, when
   * its newest file came, its files' mean bitrate, and the first episode
   * not yet watched by the library's measure (specials last). Search
   * matches show titles, and `limit` keeps the first that many.
   */
  listShows({
    libraryId,
    search = '',
    sort = 'title',
    seed = 0,
    limit,
  }: {
    libraryId: number
    search?: string
    sort?: MediaSort
    seed?: number
    limit?: number
  }): ShowEntry[] {
    const pattern = likePattern(search.trim())
    const rows = this.db
      .prepare<[number, string, string, number], ShowRow>(
        `WITH files AS (${EPISODE_FILES})
         SELECT sh.id, sh.ended, COUNT(DISTINCT f.episode_id) AS episodes,
                COUNT(DISTINCT CASE WHEN f.watched = 1 THEN f.episode_id END) AS watched_episodes,
                MAX(f.added_at) AS added_at,
                MAX(f.changed_at) AS changed_at, AVG(f.bitrate) AS bitrate,
                ${score({ item: 'sh.id', source: 'l.ratings_source' })} AS score
           FROM files f
           JOIN shown_items sh ON sh.id = f.show_id
           JOIN libraries l ON l.id = f.library_id
          WHERE sh.title LIKE ? ESCAPE '\\' OR sh.original_title LIKE ? ESCAPE '\\'
          GROUP BY sh.id
          ORDER BY ${SHOW_ORDER_BY[sort]}
          LIMIT ?`,
      )
      .all(libraryId, pattern, pattern, sqlLimit({ sort, limit }))
    const showIds = rows.map((row) => row.id)
    const summaries = this.metadata.summaries(showIds)
    const next = this.nextUnwatched({ showIds, libraryIds: [libraryId] })
    const episodes = new Map(this.getMany([...next.values()]).map((item) => [item.id, item]))
    const entries = rows.flatMap((row): ShowEntry[] => {
      const show = summaries.get(row.id)
      if (!show) return []
      const nextId = next.get(row.id)
      return [
        {
          show,
          episodes: row.episodes,
          watchedEpisodes: row.watched_episodes,
          endedYear: row.ended == null ? null : Number(row.ended.slice(0, 4)) || null,
          addedAt: row.added_at,
          bitrate: row.bitrate == null ? null : Math.round(row.bitrate),
          next: (nextId == null ? null : episodes.get(nextId)) ?? null,
        },
      ]
    })
    return sort === MEDIA_SORTS.random ? shuffle({ items: entries, seed }).slice(0, limit) : entries
  }

  /**
   * The first episode of a show not yet watched, by the measure of whichever
   * of `libraryIds` holds the file, specials last; null once every one is.
   */
  nextEpisode({
    showId,
    libraryIds,
  }: {
    showId: number
    libraryIds: readonly number[]
  }): MediaItem | null {
    const next = this.nextUnwatched({ showIds: [showId], libraryIds }).get(showId)
    return next == null ? null : this.get(next)
  }

  /**
   * An episode on disk under `itemId`, a show or a season, picked at random:
   * every episode is as likely as the next, however many files it has, and
   * the best of its files in `libraryIds` is the one. Null with no episode
   * there to play. `roll` is the die, 0 up to 1, so a test can load it.
   */
  randomEpisode({
    itemId,
    libraryIds,
    roll = Math.random,
  }: {
    itemId: number
    libraryIds: readonly number[]
    roll?: () => number
  }): MediaItem | null {
    const rows = this.db
      .prepare<[number, number, string], { media_id: number }>(
        `WITH files AS (
           SELECT m.id AS media_id, e.id AS episode_id, COALESCE(m.width * m.height, 0) AS pixels
             FROM media m
             JOIN media_items mi ON mi.media_id = m.id
             JOIN shown_items e ON e.id = mi.item_id AND e.type = 'episode'
             JOIN shown_items s ON s.id = e.parent_id
            WHERE (s.id = ? OR s.parent_id = ?)
              AND m.library_id IN (SELECT value FROM json_each(?))),
         ranked AS (
           SELECT episode_id, media_id,
                  ROW_NUMBER() OVER (PARTITION BY episode_id ORDER BY pixels DESC, media_id) AS rank
             FROM files)
         SELECT media_id FROM ranked WHERE rank = 1 ORDER BY episode_id`,
      )
      .all(itemId, itemId, JSON.stringify(libraryIds))
    const picked = rows[Math.min(rows.length - 1, Math.floor(roll() * rows.length))]
    return picked == null ? null : this.get(picked.media_id)
  }

  /**
   * The episodes among `ids` that are watched, each once for every library
   * where one of its files is: a page counts only the libraries it may show.
   */
  watchedEpisodes(ids: readonly number[]): { episodeId: number; libraryId: number }[] {
    if (ids.length === 0) return []
    return this.db
      .prepare<[string], { episode_id: number; library_id: number }>(
        `SELECT DISTINCT mi.item_id AS episode_id, m.library_id
           FROM media_items mi
           JOIN media m ON m.id = mi.media_id
           JOIN libraries l ON l.id = m.library_id
          WHERE mi.item_id IN (SELECT value FROM json_each(?)) AND ${fileWatched('m')}`,
      )
      .all(JSON.stringify(ids))
      .map((row) => ({ episodeId: row.episode_id, libraryId: row.library_id }))
  }

  /** A library's files no show or movie was found for, pending ones included, by title. */
  listUnmatched({ libraryId, search = '' }: { libraryId: number; search?: string }): MediaItem[] {
    return this.items(
      this.db
        .prepare<[number, string], MediaRow>(
          `${SELECT_MEDIA}
            WHERE m.library_id = ? AND m.match IN ('pending', 'unmatched')
              AND m.title LIKE ? ESCAPE '\\'
            ORDER BY m.title COLLATE NOCASE, m.id`,
        )
        .all(libraryId, likePattern(search.trim())),
    )
  }

  /** Every file that is an item, in any library, best first. */
  forItem(itemId: number): MediaItem[] {
    return this.forItems([itemId]).get(itemId) ?? []
  }

  /** Every file that is each of the items, in any library, best first, in one read. */
  forItems(itemIds: readonly number[]): Map<number, MediaItem[]> {
    if (itemIds.length === 0) return new Map()
    const rows = this.db
      .prepare<[string], MediaRow & { linked_item: number }>(
        `${SELECT_COLUMNS}, x.item_id AS linked_item${FROM_MEDIA}
           JOIN media_items x ON x.media_id = m.id
          WHERE x.item_id IN (SELECT value FROM json_each(?))
          ORDER BY ${BEST_FIRST}`,
      )
      .all(JSON.stringify(itemIds))
    const items = this.items(rows)
    return rows.reduce((byItem, row, index) => {
      const item = items[index]
      if (!item) return byItem
      return byItem.set(row.linked_item, [...(byItem.get(row.linked_item) ?? []), item])
    }, new Map<number, MediaItem[]>())
  }

  /**
   * Every video with a saved spot, across every library that saves progress
   * or in `libraryId` alone, the most recently watched first. A finished or
   * barely started video has no spot, so it is not in progress.
   */
  listInProgress({ libraryId = null }: { libraryId?: number | null } = {}): MediaItem[] {
    return this.items(
      this.db
        .prepare<{ libraryId: number | null }, MediaRow>(
          `${SELECT_MEDIA} WHERE p.media_id IS NOT NULL AND l.save_progress = 1
              AND (@libraryId IS NULL OR m.library_id = @libraryId)
            ORDER BY p.updated_at DESC, m.id DESC`,
        )
        .all({ libraryId }),
    )
  }

  /**
   * What stands for a library on the Libraries page: the backdrop of its
   * newest video's movie or show, by `ItemImagesRepository.backdropFor`, else
   * that video's thumbnail once it is made. Asked for every library each
   * time the page polls, so it reads that one file and nothing of a listing.
   */
  backdropOf(libraryId: number): LibraryBackdrop | null {
    const newest = this.db
      .prepare<
        [number],
        { id: number; thumbnail: string; mtime_ms: number; item_id: number | null }
      >(
        `SELECT m.id, m.thumbnail, m.mtime_ms,
                (SELECT MIN(mi.item_id) FROM media_items mi WHERE mi.media_id = m.id) AS item_id
           FROM media m
          WHERE m.library_id = ?
          ORDER BY m.added_at DESC, m.id DESC
          LIMIT 1`,
      )
      .get(libraryId)
    if (!newest) return null
    const backdrop = newest.item_id == null ? null : this.images.backdropFor(newest.item_id)
    if (backdrop) return { type: 'item', ...backdrop }
    return newest.thumbnail === 'ready'
      ? { type: 'thumbnail', id: newest.id, version: newest.mtime_ms }
      : null
  }

  /** Each video with the item whose poster its card shows, by `MetadataRepository.posterItems`. */
  withPosters(videos: readonly MediaItem[]): PosterEntry[] {
    const posters = this.metadata.posterItems(
      videos.flatMap((media) => (media.item ? [media.item.id] : [])),
    )
    return videos.map((media) => ({
      media,
      poster: media.item ? (posters.get(media.item.id) ?? null) : null,
    }))
  }

  /** Every favourite across every library, or in `libraryId` alone, most recently marked first. */
  listFavourites({ libraryId = null }: { libraryId?: number | null } = {}): MediaItem[] {
    return this.items(
      this.db
        .prepare<{ libraryId: number | null }, MediaRow>(
          `${SELECT_MEDIA} WHERE f.media_id IS NOT NULL
              AND (@libraryId IS NULL OR m.library_id = @libraryId)
            ORDER BY f.added_at DESC, m.id DESC`,
        )
        .all({ libraryId }),
    )
  }

  /**
   * A library's sagas: each TMDB collection two or more of its movies belong
   * to, by name, with the backdrop the library picked for it and those
   * movies oldest first, one entry each, its best file. A movie split onto
   * several cards is still one movie, so a single movie of a collection is
   * no saga yet, however many cards it has.
   */
  listSagas(libraryId: number): Saga[] {
    const movies = this.items(
      this.db
        .prepare<[number], MediaRow>(
          `WITH ranked AS (
             ${SELECT_COLUMNS},
                    ROW_NUMBER() OVER (PARTITION BY i.id ORDER BY ${BEST_FIRST}) AS version_rank
             ${FROM_MEDIA}
              WHERE m.library_id = ? AND i.type = 'movie' AND t.saga_tmdb_id IS NOT NULL)
           SELECT * FROM ranked WHERE version_rank = 1 ORDER BY ${ORDER_BY['year-old']}`,
        )
        .all(libraryId),
    )
    const sagas = this.metadata.sagasOf(movies.flatMap((media) => media.item?.id ?? []))
    const backdrops = this.sagaBackdrops.ofLibrary(libraryId)
    const grouped = movies.reduce((groups, media) => {
      const saga = media.item ? sagas.get(media.item.id) : undefined
      if (!saga) return groups
      const held = groups.get(saga.tmdbId)?.media ?? []
      const backdrop = backdrops.get(saga.tmdbId) ?? DEFAULT_SAGA_BACKDROP
      return groups.set(saga.tmdbId, { ...saga, backdrop, media: [...held, media] })
    }, new Map<string, Saga>())
    return [...grouped.values()]
      .filter((saga) => saga.media.length > 1)
      .toSorted((a, b) => a.name.localeCompare(b.name))
  }
}
