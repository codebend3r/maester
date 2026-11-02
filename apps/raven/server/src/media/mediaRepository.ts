import { Inject, Injectable } from '@nestjs/common'
import {
  DEFAULT_SAGA_BACKDROP,
  ITEM_TYPES,
  type ItemSummary,
  LIBRARY_BACKDROP_TYPES,
  type LibraryBackdrop,
  MEDIA_SORTS,
  type MediaItem,
  type MediaSort,
  type PosterEntry,
  type Saga,
  type ShowEntry,
  SESSION_KINDS,
  SHUFFLE_LENGTH,
  THUMBNAIL_STATES,
  type ViewingSession,
  isMatchState,
  isThumbnailState,
  readCut,
  readRelease,
  shuffled,
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
import type { AccountKey, ByAccount } from '@/media/viewingAccountKeys'
import { ItemImagesRepository } from '@/metadata/itemImagesRepository'
import { MetadataRepository } from '@/metadata/metadataRepository'
import { MusicRepository } from '@/music/musicRepository'

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
         i.year AS item_year, i.released AS item_released, t.title AS item_tmdb_title,
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
    LEFT JOIN playback_progress p ON p.account_id = @account AND p.media_id = m.id
    LEFT JOIN favourites f ON f.account_id = @account AND f.media_id = m.id
    LEFT JOIN ${FIRST_ITEM}
    LEFT JOIN shown_items i ON i.id = mi.item_id
    LEFT JOIN items t ON t.id = mi.item_id`

const SELECT_MEDIA = `${SELECT_COLUMNS}${FROM_MEDIA}`

/** A video `account` has a saved spot in, in a library that saves progress: what is in progress. */
const IN_PROGRESS = 'p.media_id IS NOT NULL AND l.save_progress = 1'

/** A video `account` favoured, in a library that is not locked. */
const FAVOURITE = 'f.media_id IS NOT NULL AND l.locked = 0'

/**
 * What sets a split movie file's card apart: the cut Smart split apart
 * gave it, else the cut or release its name reads as. Null for a file on
 * its movie's own card, and for anything but a movie.
 */
const variantOf = (row: MediaRow): string | null => {
  if (row.item_type !== ITEM_TYPES.movie || row.split == null) return null
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
  card: row.item_type === ITEM_TYPES.movie ? row.split : null,
  album: null,
})

/** A show in a TV library's listing, before its next episode is looked up. */
type ShowRow = {
  id: number
  ended: string | null
  episodes: number
  seasons: number
  total_episodes: number
  watched_episodes: number
  added_at: string
  bitrate: number | null
}

const SHOW_BY_TITLE = 'sh.sort_title COLLATE NOCASE, sh.id'

/** The day a show first aired, else its year alone. */
const SHOW_RELEASED = 'COALESCE(sh.released, CAST(sh.year AS TEXT))'

/**
 * A show's listing order: by its files' mean bitrate for the bitrate sorts,
 * by the day it first aired for the release sorts, and by title for the
 * others that only mean something per file.
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
  'year-new': `${SHOW_RELEASED} IS NULL, ${SHOW_RELEASED} DESC, ${SHOW_BY_TITLE}`,
  'year-old': `${SHOW_RELEASED} IS NULL, ${SHOW_RELEASED}, ${SHOW_BY_TITLE}`,
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
   WHERE m.library_id = ?
     AND (? IS NULL OR s.parent_id IN (SELECT value FROM json_each(?)))`

const BY_TITLE = 'COALESCE(item_sort_title, title) COLLATE NOCASE, id'

/** SQLite reads a negative LIMIT as none. */
const NO_LIMIT = -1

type SqlLimitProps = { sort: MediaSort; limit: number | undefined }

/**
 * The LIMIT a listing reads with. A random sort deals from every row, so it
 * reads them all and is cut after the shuffle.
 */
const sqlLimit = ({ sort, limit }: SqlLimitProps): number =>
  sort === MEDIA_SORTS.random ? NO_LIMIT : (limit ?? NO_LIMIT)

const YEAR = 'COALESCE(item_year, year)'

/** A card's library and the item on it, if any. */
type CardItem = { libraryId: number; itemId: number | null }

/** The items one library's cards hold. */
type LibraryItems = { ids: number[]; libraryId: number }

type InEachLibraryProps = {
  entries: readonly CardItem[]
  /** The summaries of `ids` as `libraryId`'s cards show them, keyed by id. */
  lookup: (asked: LibraryItems) => Map<number, ItemSummary>
}

/**
 * Each entry's item as its own library shows it, in order: `lookup` runs
 * once per library, since each can choose its own pictures for a title.
 */
const inEachLibrary = ({ entries, lookup }: InEachLibraryProps): Array<ItemSummary | null> => {
  const byLibrary = new Map(
    [...new Set(entries.map((entry) => entry.libraryId))].map((libraryId) => [
      libraryId,
      lookup({
        libraryId,
        ids: entries.flatMap((entry) =>
          entry.libraryId === libraryId && entry.itemId != null ? [entry.itemId] : [],
        ),
      }),
    ]),
  )
  return entries.map(({ libraryId, itemId }) =>
    itemId == null ? null : (byLibrary.get(libraryId)?.get(itemId) ?? null),
  )
}

/**
 * The day a title came out, as `YYYY-MM-DD`, else its year alone, which
 * sorts as the start of that year.
 */
const RELEASED = `COALESCE(item_released, CAST(${YEAR} AS TEXT))`

/**
 * ORDER BY for each sort, over the listing's columns. Ties fall back to
 * title. Bitrate, resolution and release are unknown for some files, and
 * those go last either way. Random lists by title here and is shuffled after.
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
  'year-new': `${RELEASED} IS NULL, ${RELEASED} DESC, ${BY_TITLE}`,
  'year-old': `${RELEASED} IS NULL, ${RELEASED}, ${BY_TITLE}`,
  'rating-high': `score IS NULL, score DESC, ${BY_TITLE}`,
  'rating-low': `score IS NULL, score, ${BY_TITLE}`,
  random: BY_TITLE,
}

type MediaRepositoryGetManyProps = { ids: readonly number[]; account: AccountKey }

type MediaRepositoryGetProps = { id: number; account: AccountKey }

type MediaRepositoryListProps = {
  libraryId: number
  search?: string
  sort?: MediaSort
  seed?: number
  limit?: number
  account: AccountKey
}

type MediaRepositoryNextUnwatchedProps = {
  showIds: readonly number[]
  libraryIds: readonly number[]
  account: AccountKey
}

type MediaRepositoryListShowsProps = {
  libraryId: number
  search?: string
  sort?: MediaSort
  seed?: number
  limit?: number
  /** Only these shows; null lists them all. */
  showIds?: readonly number[] | null
  account: AccountKey
}

type MediaRepositoryNewestReleasedProps = {
  libraryId: number
  type: typeof ITEM_TYPES.movie | typeof ITEM_TYPES.show
  limit: number
}

type MediaRepositoryNextEpisodeProps = {
  showId: number
  libraryIds: readonly number[]
  account: AccountKey
}

type MediaRepositoryNextInSessionProps = {
  media: MediaItem
  session: ViewingSession
  account: AccountKey
}

type MediaRepositoryNextInShowProps = {
  mediaId: number
  libraryId: number
  isSeasonOnly: boolean
  account: AccountKey
}

type MediaRepositoryNextInSagaProps = {
  media: MediaItem
  sagaId: string
  account: AccountKey
}

type MediaRepositoryShuffledEpisodesProps = {
  itemId: number
  libraryIds: readonly number[]
  roll?: () => number
  account: AccountKey
}

type MediaRepositoryWatchedEpisodesProps = {
  ids: readonly number[]
  account: AccountKey
}

type MediaRepositoryListUnmatchedProps = {
  libraryId: number
  search?: string
  account: AccountKey
}

type MediaRepositoryForItemProps = { itemId: number; account: AccountKey }

type MediaRepositoryForItemsProps = {
  itemIds: readonly number[]
  account: AccountKey
}

type MediaRepositoryListInProgressProps = {
  libraryId?: number | null
  account: AccountKey
}

type MediaRepositoryListFavouritesProps = {
  libraryId?: number | null
  account: AccountKey
}

type MediaRepositoryListSagasProps = { libraryId: number; account: AccountKey }

type MediaRepositoryCountInProgressProps = { libraryId: number; account: AccountKey }

type MediaRepositoryNextUpProps = { libraryId: number | null; account: AccountKey }

type NextUpShowRow = { show_id: number; library_id: number; last_played_at: string }

type ProgressTimeRow = { media_id: number; updated_at: string }

type DatedVideo = { media: MediaItem; at: string }

type MediaRepositoryCountFavouritesProps = { libraryId: number; account: AccountKey }

type MediaRepositoryCountSagasProps = { libraryId: number; account: AccountKey }

type MediaRepositoryCountWhereProps = { where: string; libraryId: number; account: AccountKey }

type MediaRepositorySagaGroupsProps = { libraryId: number; account: AccountKey }

/** A saga as its movies make it, before the library's pick of backdrop is put on it. */
type SagaGroup = Omit<Saga, 'backdrop'>

/**
 * The videos as a client sees them: listings, a show's next episode, an
 * item's files, favourites. Each read is one account's, whose spots,
 * favourites and plays it binds as `@account`. Every answer is a
 * `MediaItem`, which has no path, so nothing read here can hand a client
 * one. What the server needs of a file itself, its path above all, is
 * `MediaIndex`'s.
 */
@Injectable()
export class MediaRepository {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(MetadataRepository) private readonly metadata: MetadataRepository,
    @Inject(ItemImagesRepository) private readonly images: ItemImagesRepository,
    @Inject(SagaBackdrops) private readonly sagaBackdrops: SagaBackdrops,
    @Inject(MusicRepository) private readonly music: MusicRepository,
  ) {}

  private get db() {
    return this.database.db
  }

  /**
   * Items for rows, each with its item's summary attached, as its own
   * library shows it: a title in two libraries can have two posters.
   */
  private items(rows: readonly MediaRow[]): MediaItem[] {
    const summaries = inEachLibrary({
      entries: rows.map((row) => ({ libraryId: row.library_id, itemId: row.item_id })),
      lookup: (asked) => this.metadata.summaries(asked),
    })
    const albums = this.music.albumsOfMedia(rows.map((row) => row.id))
    return rows.map((row, index) => ({
      ...toItem(row),
      item: summaries[index] ?? null,
      album: albums.get(row.id) ?? null,
    }))
  }

  /**
   * The videos with these ids, in the order asked, as `account` sees them;
   * one that is gone is left out.
   */
  getMany({ ids, account }: MediaRepositoryGetManyProps): MediaItem[] {
    if (ids.length === 0) return []
    const found = new Map(
      this.items(
        this.db
          .prepare<[ByAccount, string], MediaRow>(
            `${SELECT_MEDIA} WHERE m.id IN (SELECT value FROM json_each(?))`,
          )
          .all({ account }, JSON.stringify(ids)),
      ).map((item) => [item.id, item]),
    )
    return ids.flatMap((id) => found.get(id) ?? [])
  }

  get({ id, account }: MediaRepositoryGetProps): MediaItem | null {
    return this.getMany({ ids: [id], account })[0] ?? null
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
    account,
  }: MediaRepositoryListProps): MediaItem[] {
    const pattern = likePattern(search.trim())
    const rows = this.db
      .prepare<[ByAccount, number, string, string, string, number], MediaRow>(
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
      .all({ account }, libraryId, pattern, pattern, pattern, sqlLimit({ sort, limit }))
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
    account,
  }: MediaRepositoryNextUnwatchedProps): Map<number, number> {
    const rows = this.db
      .prepare<[ByAccount, string, string], { show_id: number; media_id: number }>(
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
      .all({ account }, JSON.stringify(showIds), JSON.stringify(libraryIds))
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
    showIds = null,
    account,
  }: MediaRepositoryListShowsProps): ShowEntry[] {
    const pattern = likePattern(search.trim())
    const only = showIds == null ? null : JSON.stringify(showIds)
    const rows = this.db
      .prepare<[ByAccount, number, string | null, string | null, string, string, number], ShowRow>(
        `WITH files AS (${EPISODE_FILES})
         SELECT sh.id, sh.ended, COUNT(DISTINCT f.episode_id) AS episodes,
                (SELECT COUNT(*) FROM items s WHERE s.parent_id = sh.id AND s.type = 'season') AS seasons,
                (SELECT COUNT(*) FROM items e JOIN items s ON s.id = e.parent_id
                  WHERE s.parent_id = sh.id AND s.type = 'season' AND e.type = 'episode') AS total_episodes,
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
      .all({ account }, libraryId, only, only, pattern, pattern, sqlLimit({ sort, limit }))
    const listedIds = rows.map((row) => row.id)
    const summaries = this.metadata.summaries({ ids: listedIds, libraryId })
    const next = this.nextUnwatched({ showIds: listedIds, libraryIds: [libraryId], account })
    const episodes = new Map(
      this.getMany({ ids: [...next.values()], account }).map((item) => [item.id, item]),
    )
    const entries = rows.flatMap((row): ShowEntry[] => {
      const show = summaries.get(row.id)
      if (!show) return []
      const nextId = next.get(row.id)
      return [
        {
          show,
          episodes: row.episodes,
          seasons: row.seasons,
          totalEpisodes: row.total_episodes,
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
   * The ids of a library's matched movies, or of its shows, the most
   * recently released first (a title with no date goes by its year, one with
   * neither goes last), at most `limit`. A read of the matched items alone,
   * so the hero costs none of a listing's per-file work.
   */
  newestReleased({ libraryId, type, limit }: MediaRepositoryNewestReleasedProps): number[] {
    const held =
      type === ITEM_TYPES.movie
        ? `SELECT mi.item_id AS id
             FROM media m JOIN media_items mi ON mi.media_id = m.id
            WHERE m.library_id = ?`
        : `SELECT s.parent_id AS id
             FROM media m
             JOIN media_items mi ON mi.media_id = m.id
             JOIN shown_items e ON e.id = mi.item_id AND e.type = 'episode'
             JOIN shown_items s ON s.id = e.parent_id
            WHERE m.library_id = ?`
    return this.db
      .prepare<[number, string, number], { id: number }>(
        `WITH held AS (${held}),
              released AS (
                SELECT i.id, i.sort_title,
                       COALESCE(i.released, CAST(i.year AS TEXT)) AS released
                  FROM shown_items i
                 WHERE i.id IN (SELECT id FROM held) AND i.type = ?)
         SELECT id FROM released
          ORDER BY released IS NULL, released DESC, sort_title COLLATE NOCASE, id
          LIMIT ?`,
      )
      .all(libraryId, type, limit)
      .map((row) => row.id)
  }

  /**
   * The first episode of a show not yet watched, by the measure of whichever
   * of `libraryIds` holds the file, specials last; null once every one is.
   */
  nextEpisode({ showId, libraryIds, account }: MediaRepositoryNextEpisodeProps): MediaItem | null {
    const next = this.nextUnwatched({ showIds: [showId], libraryIds, account }).get(showId)
    return next == null ? null : this.get({ id: next, account })
  }

  /**
   * What plays after `media` in `session`, from the same library: the next
   * episode of its season or its show, or the next film of its saga; null
   * at the session's end, and for a session whose next is not the server's.
   */
  nextInSession({ media, session, account }: MediaRepositoryNextInSessionProps): MediaItem | null {
    switch (session.kind) {
      case SESSION_KINDS.season:
      case SESSION_KINDS.show:
        return this.nextInShow({
          mediaId: media.id,
          libraryId: media.libraryId,
          isSeasonOnly: session.kind === SESSION_KINDS.season,
          account,
        })
      case SESSION_KINDS.saga:
        return this.nextInSaga({ media, sagaId: session.sagaId, account })
      case SESSION_KINDS.single:
      case SESSION_KINDS.queue:
        return null
      default: {
        const unknown: never = session
        return unknown
      }
    }
  }

  /**
   * The best file in `libraryId` of the episode after `mediaId`'s, in show
   * order: specials last, then by season and episode. A file of several
   * episodes counts as its last. `isSeasonOnly` stops at its season's end.
   */
  private nextInShow({
    mediaId,
    libraryId,
    isSeasonOnly,
    account,
  }: MediaRepositoryNextInShowProps): MediaItem | null {
    const row = this.db
      .prepare<{ mediaId: number; libraryId: number; isSeasonOnly: number }, { media_id: number }>(
        `WITH current AS (
           SELECT s.id AS season_id, s.parent_id AS show_id,
                  s.number AS season_number, e.number AS episode_number
             FROM media_items mi
             JOIN shown_items e ON e.id = mi.item_id AND e.type = 'episode'
             JOIN shown_items s ON s.id = e.parent_id
            WHERE mi.media_id = @mediaId
            ORDER BY s.number = 0 DESC, s.number DESC, e.number DESC
            LIMIT 1),
         files AS (
           SELECT m.id AS media_id, s.number AS season_number, e.number AS episode_number,
                  COALESCE(m.width * m.height, 0) AS pixels
             FROM current c
             JOIN shown_items s ON s.parent_id = c.show_id
                               AND (@isSeasonOnly = 0 OR s.id = c.season_id)
             JOIN shown_items e ON e.parent_id = s.id AND e.type = 'episode'
             JOIN media_items mi ON mi.item_id = e.id
             JOIN media m ON m.id = mi.media_id
            WHERE m.library_id = @libraryId)
         SELECT f.media_id
           FROM files f, current c
          WHERE (f.season_number = 0, f.season_number, f.episode_number)
                > (c.season_number = 0, c.season_number, c.episode_number)
          ORDER BY f.season_number = 0, f.season_number, f.episode_number, f.pixels DESC, f.media_id
          LIMIT 1`,
      )
      .get({ mediaId, libraryId, isSeasonOnly: isSeasonOnly ? 1 : 0 })
    return row ? this.get({ id: row.media_id, account }) : null
  }

  /** The film after `media`'s in saga `sagaId` of its library, oldest first, as the saga's page lists them. */
  private nextInSaga({ media, sagaId, account }: MediaRepositoryNextInSagaProps): MediaItem | null {
    const films =
      this.sagaGroups({ libraryId: media.libraryId, account }).find(
        (saga) => saga.tmdbId === sagaId,
      )?.media ?? []
    const at = films.findIndex(
      (film) => film.item != null && film.item.id === (media.item?.id ?? null),
    )
    return at < 0 ? null : (films[at + 1] ?? null)
  }

  /**
   * The episodes on disk under `itemId`, a show or a season, in a random
   * order, `SHUFFLE_LENGTH` at most: every episode is as likely as the next,
   * however many files it has, and the best of its files in `libraryIds` is
   * the one. Empty with no episode there to play. `roll` is the die, 0 up to
   * 1, so a test can load it.
   */
  shuffledEpisodes({
    itemId,
    libraryIds,
    roll = Math.random,
    account,
  }: MediaRepositoryShuffledEpisodesProps): MediaItem[] {
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
    const dealt = shuffled({ items: rows.map((row) => row.media_id), roll })
    return this.getMany({ ids: dealt.slice(0, SHUFFLE_LENGTH), account })
  }

  /**
   * The episodes among `ids` that `account` watched, each once for every
   * library where one of its files is: a page counts only the libraries it
   * may show.
   */
  watchedEpisodes({
    ids,
    account,
  }: MediaRepositoryWatchedEpisodesProps): { episodeId: number; libraryId: number }[] {
    if (ids.length === 0) return []
    return this.db
      .prepare<[ByAccount, string], { episode_id: number; library_id: number }>(
        `SELECT DISTINCT mi.item_id AS episode_id, m.library_id
           FROM media_items mi
           JOIN media m ON m.id = mi.media_id
           JOIN libraries l ON l.id = m.library_id
          WHERE mi.item_id IN (SELECT value FROM json_each(?)) AND ${fileWatched('m')}`,
      )
      .all({ account }, JSON.stringify(ids))
      .map((row) => ({ episodeId: row.episode_id, libraryId: row.library_id }))
  }

  /** A library's files no show or movie was found for, pending ones included, by title. */
  listUnmatched({
    libraryId,
    search = '',
    account,
  }: MediaRepositoryListUnmatchedProps): MediaItem[] {
    return this.items(
      this.db
        .prepare<[ByAccount, number, string], MediaRow>(
          `${SELECT_MEDIA}
            WHERE m.library_id = ? AND m.match IN ('pending', 'unmatched')
              AND m.title LIKE ? ESCAPE '\\'
            ORDER BY m.title COLLATE NOCASE, m.id`,
        )
        .all({ account }, libraryId, likePattern(search.trim())),
    )
  }

  /** Every file that is an item, in any library, best first. */
  forItem({ itemId, account }: MediaRepositoryForItemProps): MediaItem[] {
    return this.forItems({ itemIds: [itemId], account }).get(itemId) ?? []
  }

  /** Every file that is each of the items, in any library, best first, in one read. */
  forItems({ itemIds, account }: MediaRepositoryForItemsProps): Map<number, MediaItem[]> {
    if (itemIds.length === 0) return new Map()
    const rows = this.db
      .prepare<[ByAccount, string], MediaRow & { linked_item: number }>(
        `${SELECT_COLUMNS}, x.item_id AS linked_item${FROM_MEDIA}
           JOIN media_items x ON x.media_id = m.id
          WHERE x.item_id IN (SELECT value FROM json_each(?))
          ORDER BY ${BEST_FIRST}`,
      )
      .all({ account }, JSON.stringify(itemIds))
    const items = this.items(rows)
    return rows.reduce((byItem, row, index) => {
      const item = items[index]
      if (!item) return byItem
      return byItem.set(row.linked_item, [...(byItem.get(row.linked_item) ?? []), item])
    }, new Map<number, MediaItem[]>())
  }

  /**
   * Every video `account` has a saved spot in, across every library that
   * saves progress or in `libraryId` alone, then the next episode of each
   * show it is partway through (`nextUp`), the most recently watched first.
   * A finished or barely started video has no spot, so it is not in
   * progress itself.
   */
  listInProgress({ libraryId = null, account }: MediaRepositoryListInProgressProps): MediaItem[] {
    const started = this.items(
      this.db
        .prepare<{ libraryId: number | null; account: AccountKey }, MediaRow>(
          `${SELECT_MEDIA} WHERE ${IN_PROGRESS}
              AND (@libraryId IS NULL OR m.library_id = @libraryId)
            ORDER BY p.updated_at DESC, m.id DESC`,
        )
        .all({ libraryId, account }),
    )
    const upNext = this.nextUp({ libraryId, account })
    if (upNext.length === 0) return started
    const times = new Map(
      this.db
        .prepare<[ByAccount, string], ProgressTimeRow>(
          `SELECT media_id, updated_at FROM playback_progress
            WHERE account_id = @account AND media_id IN (SELECT value FROM json_each(?))`,
        )
        .all({ account }, JSON.stringify(started.map((media) => media.id)))
        .map((row) => [row.media_id, row.updated_at]),
    )
    const dated: DatedVideo[] = started.map((media) => ({ media, at: times.get(media.id) ?? '' }))
    return [...dated, ...upNext]
      .toSorted((a, b) => b.at.localeCompare(a.at))
      .map(({ media }) => media)
  }

  /**
   * The first unwatched episode of each show `account` has watched an episode
   * of, in a library that saves progress, unless an episode of the show is
   * in progress already: it keeps a binge going from the start of the next
   * episode. Each comes with when the show was last watched, and starts from
   * the beginning.
   */
  private nextUp({ libraryId, account }: MediaRepositoryNextUpProps): DatedVideo[] {
    const shows = this.db
      .prepare<{ libraryId: number | null; account: AccountKey }, NextUpShowRow>(
        `SELECT s.parent_id AS show_id, m.library_id,
                MAX((SELECT MAX(pl.played_at) FROM plays pl
                      WHERE pl.account_id = @account AND pl.media_id = m.id)) AS last_played_at
           FROM media m
           JOIN libraries l ON l.id = m.library_id
           JOIN media_items mi ON mi.media_id = m.id
           JOIN shown_items e ON e.id = mi.item_id AND e.type = 'episode'
           JOIN shown_items s ON s.id = e.parent_id
          WHERE l.save_progress = 1
            AND (@libraryId IS NULL OR m.library_id = @libraryId)
            AND ${fileWatched('m')}
            AND NOT EXISTS (
              SELECT 1 FROM playback_progress pp
                JOIN media_items pmi ON pmi.media_id = pp.media_id
                JOIN shown_items pe ON pe.id = pmi.item_id AND pe.type = 'episode'
                JOIN shown_items ps ON ps.id = pe.parent_id
                JOIN media pm ON pm.id = pp.media_id
                JOIN libraries pl2 ON pl2.id = pm.library_id
               WHERE pp.account_id = @account AND pl2.save_progress = 1
                 AND ps.parent_id = s.parent_id)
          GROUP BY s.parent_id, m.library_id`,
      )
      .all({ libraryId, account })
    if (shows.length === 0) return []
    const lastWatched = shows.reduce(
      (latest, row) =>
        (latest.get(row.show_id) ?? '') >= row.last_played_at
          ? latest
          : latest.set(row.show_id, row.last_played_at),
      new Map<number, string>(),
    )
    const next = this.nextUnwatched({
      showIds: [...lastWatched.keys()],
      libraryIds: [...new Set(shows.map((row) => row.library_id))],
      account,
    })
    const episodes = new Map(
      this.getMany({ ids: [...next.values()], account }).map((item) => [item.id, item]),
    )
    return [...next].flatMap(([showId, mediaId]): DatedVideo[] => {
      const media = episodes.get(mediaId)
      return media ? [{ media: { ...media, position: 0 }, at: lastWatched.get(showId) ?? '' }] : []
    })
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
    const backdrop =
      newest.item_id == null ? null : this.images.backdropFor({ itemId: newest.item_id, libraryId })
    if (backdrop) return { type: LIBRARY_BACKDROP_TYPES.item, ...backdrop }
    return newest.thumbnail === THUMBNAIL_STATES.ready
      ? { type: LIBRARY_BACKDROP_TYPES.thumbnail, id: newest.id, version: newest.mtime_ms }
      : null
  }

  /**
   * Each video with the item whose poster its card shows, by
   * `MetadataRepository.posterItems`, as the video's own library shows it.
   */
  withPosters(videos: readonly MediaItem[]): PosterEntry[] {
    const posters = inEachLibrary({
      entries: videos.map((media) => ({
        libraryId: media.libraryId,
        itemId: media.item?.id ?? null,
      })),
      lookup: (asked) => this.metadata.posterItems(asked),
    })
    return videos.map((media, index) => ({ media, poster: posters[index] ?? null }))
  }

  /**
   * Every favourite of `account` across every library, or in `libraryId`
   * alone, most recently marked first. A locked library's are left out,
   * whether or not the PIN is entered.
   */
  listFavourites({ libraryId = null, account }: MediaRepositoryListFavouritesProps): MediaItem[] {
    return this.items(
      this.db
        .prepare<{ libraryId: number | null; account: AccountKey }, MediaRow>(
          `${SELECT_MEDIA} WHERE ${FAVOURITE}
              AND (@libraryId IS NULL OR m.library_id = @libraryId)
            ORDER BY f.added_at DESC, m.id DESC`,
        )
        .all({ libraryId, account }),
    )
  }

  /** How many of a library's videos match `where`, over the same rows its listings read. */
  private countWhere({ where, libraryId, account }: MediaRepositoryCountWhereProps): number {
    return (
      this.db
        .prepare<[ByAccount, number], { count: number }>(
          `SELECT COUNT(*) AS count${FROM_MEDIA} WHERE ${where} AND m.library_id = ?`,
        )
        .get({ account }, libraryId)?.count ?? 0
    )
  }

  /** How many videos `listInProgress` lists for the library, without reading them. */
  countInProgress({ libraryId, account }: MediaRepositoryCountInProgressProps): number {
    return (
      this.countWhere({ where: IN_PROGRESS, libraryId, account }) +
      this.nextUp({ libraryId, account }).length
    )
  }

  /** How many videos `listFavourites` lists for the library, without reading them. */
  countFavourites({ libraryId, account }: MediaRepositoryCountFavouritesProps): number {
    return this.countWhere({ where: FAVOURITE, libraryId, account })
  }

  /**
   * Each TMDB collection two or more of a library's movies belong to, with
   * those movies oldest first, one entry each, its best file. A movie split
   * onto several cards is still one movie, so a single movie of a
   * collection is no saga yet, however many cards it has.
   */
  private sagaGroups({ libraryId, account }: MediaRepositorySagaGroupsProps): SagaGroup[] {
    const movies = this.items(
      this.db
        .prepare<[ByAccount, number], MediaRow>(
          `WITH ranked AS (
             ${SELECT_COLUMNS},
                    ROW_NUMBER() OVER (PARTITION BY i.id ORDER BY ${BEST_FIRST}) AS version_rank
             ${FROM_MEDIA}
              WHERE m.library_id = ? AND i.type = 'movie' AND t.saga_tmdb_id IS NOT NULL)
           SELECT * FROM ranked WHERE version_rank = 1 ORDER BY ${ORDER_BY['year-old']}`,
        )
        .all({ account }, libraryId),
    )
    const sagas = this.metadata.sagasOf(movies.flatMap((media) => media.item?.id ?? []))
    const grouped = movies.reduce((groups, media) => {
      const saga = media.item ? sagas.get(media.item.id) : undefined
      if (!saga) return groups
      const held = groups.get(saga.tmdbId)?.media ?? []
      return groups.set(saga.tmdbId, { ...saga, media: [...held, media] })
    }, new Map<string, SagaGroup>())
    return [...grouped.values()].filter((saga) => saga.media.length > 1)
  }

  /** A library's sagas, by name, each with the backdrop the library picked for it. */
  listSagas({ libraryId, account }: MediaRepositoryListSagasProps): Saga[] {
    const backdrops = this.sagaBackdrops.ofLibrary(libraryId)
    return this.sagaGroups({ libraryId, account })
      .map((saga) => ({ ...saga, backdrop: backdrops.get(saga.tmdbId) ?? DEFAULT_SAGA_BACKDROP }))
      .toSorted((a, b) => a.name.localeCompare(b.name))
  }

  /** How many sagas `listSagas` lists for the library, without their backdrops. */
  countSagas({ libraryId, account }: MediaRepositoryCountSagasProps): number {
    return this.sagaGroups({ libraryId, account }).length
  }
}
