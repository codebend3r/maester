// The columns, joins and orders the media listings read, and how a row becomes a client's `MediaItem`.
import {
  ITEM_TYPES,
  MATCH_STATES,
  MEDIA_SORTS,
  type MediaItem,
  type MediaSort,
  THUMBNAIL_STATES,
  isMatchState,
  isThumbnailState,
  readCut,
  readRelease,
} from '@raven/core'
import { cutOfSplit } from '@/media/cardSplits'
import { FIRST_ITEM, cardWatched, fileWatched, score } from '@/media/mediaSql'

/** A media row as the listings read it; the path is selected with the rest but never leaves `MediaRepository`. */
export type MediaRow = {
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
  dolby_vision_only: number
  dolby_vision_profile: number | null
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
export const SELECT_COLUMNS = `
  SELECT m.*, CASE WHEN l.save_progress = 1 THEN p.position END AS position,
         f.added_at AS favourited_at,
         i.id AS item_id, i.type AS item_type, i.title AS item_title,
         i.original_title AS item_original_title, i.sort_title AS item_sort_title,
         COALESCE(i.year, a.year) AS item_year,
         COALESCE(i.released, a.release_date) AS item_released, t.title AS item_tmdb_title,
         t.original_title AS item_tmdb_original_title,
         CASE WHEN i.type = '${ITEM_TYPES.movie}'
              THEN (SELECT COUNT(*) FROM media_items x CROSS JOIN media y ON y.id = x.media_id
                     WHERE x.item_id = i.id AND y.library_id = m.library_id
                       AND y.split IS m.split)
              ELSE 1 END AS versions,
         ${cardWatched({ file: 'm', item: 'i' })} AS watched,
         ${score({ item: 'i.id', source: 'l.ratings_source' })} AS score`

export const FROM_MEDIA = `
    FROM media m
    JOIN libraries l ON l.id = m.library_id
    LEFT JOIN playback_progress p ON p.account_id = @account AND p.media_id = m.id
    LEFT JOIN favourites f ON f.account_id = @account AND f.media_id = m.id
    LEFT JOIN ${FIRST_ITEM}
    LEFT JOIN shown_items i ON i.id = mi.item_id
    LEFT JOIN items t ON t.id = mi.item_id
    LEFT JOIN tracks audio ON audio.media_id = m.id
    LEFT JOIN albums a ON a.id = audio.album_id`

export const SELECT_MEDIA = `${SELECT_COLUMNS}${FROM_MEDIA}`

/** A video `account` has a saved spot in, in a library that saves progress: what is in progress. */
export const IN_PROGRESS = 'p.media_id IS NOT NULL AND l.save_progress = 1'

/** A video `account` favoured, in a library that is not locked. */
export const FAVOURITE = 'f.media_id IS NOT NULL AND l.locked = 0'

/**
 * What sets a split movie file's card apart: the cut Smart split apart
 * gave it, else the cut or release its name reads as. Null for a file on
 * its movie's own card, and for anything but a movie.
 */
const variantOf = (row: MediaRow): string | null => {
  if (row.item_type !== ITEM_TYPES.movie || row.split == null) return null
  const cut = cutOfSplit(row.split)
  if (cut !== null) return cut
  const titles = [row.item_tmdb_title, row.item_tmdb_original_title]
  return readCut({ fileName: row.file_name, titles })?.label ?? readRelease(row.file_name)
}

/** The client's view of a row, before its item's summary is attached: no path, no bookkeeping. */
export const toItem = (row: MediaRow): MediaItem => ({
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
  isDolbyVisionOnly: row.dolby_vision_only === 1,
  dolbyVisionProfile: row.dolby_vision_profile,
  audioCodec: row.audio_codec,
  audioChannels: row.audio_channels,
  bitrate: row.bitrate,
  thumbnail: isThumbnailState(row.thumbnail) ? row.thumbnail : THUMBNAIL_STATES.pending,
  thumbnailVersion: row.mtime_ms,
  position: row.position ?? 0,
  favourite: row.favourited_at != null,
  watched: row.watched === 1,
  addedAt: row.added_at,
  changedAt: row.changed_at,
  match: isMatchState(row.match) ? row.match : MATCH_STATES.pending,
  year: row.year,
  edition: row.edition,
  item: null,
  versions: row.versions,
  variant: variantOf(row),
  card: row.item_type === ITEM_TYPES.movie ? row.split : null,
  album: null,
})

/** A show in a TV library's listing, before its next episode is looked up. */
export type ShowRow = {
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
export const SHOW_ORDER_BY = {
  [MEDIA_SORTS.title]: SHOW_BY_TITLE,
  [MEDIA_SORTS.titleDesc]: 'sh.sort_title COLLATE NOCASE DESC, sh.id DESC',
  [MEDIA_SORTS.added]: 'added_at DESC, sh.id DESC',
  [MEDIA_SORTS.oldest]: 'added_at, sh.id',
  [MEDIA_SORTS.changed]: 'changed_at DESC, sh.id DESC',
  [MEDIA_SORTS.changedOld]: 'changed_at, sh.id',
  [MEDIA_SORTS.largest]: SHOW_BY_TITLE,
  [MEDIA_SORTS.smallest]: SHOW_BY_TITLE,
  [MEDIA_SORTS.bitrateHigh]: `bitrate IS NULL, bitrate DESC, ${SHOW_BY_TITLE}`,
  [MEDIA_SORTS.bitrateLow]: `bitrate IS NULL, bitrate, ${SHOW_BY_TITLE}`,
  [MEDIA_SORTS.resolutionHigh]: SHOW_BY_TITLE,
  [MEDIA_SORTS.resolutionLow]: SHOW_BY_TITLE,
  [MEDIA_SORTS.yearNew]: `${SHOW_RELEASED} IS NULL, ${SHOW_RELEASED} DESC, ${SHOW_BY_TITLE}`,
  [MEDIA_SORTS.yearOld]: `${SHOW_RELEASED} IS NULL, ${SHOW_RELEASED}, ${SHOW_BY_TITLE}`,
  [MEDIA_SORTS.ratingHigh]: `score IS NULL, score DESC, ${SHOW_BY_TITLE}`,
  [MEDIA_SORTS.ratingLow]: `score IS NULL, score, ${SHOW_BY_TITLE}`,
  [MEDIA_SORTS.random]: SHOW_BY_TITLE,
} as const satisfies Record<MediaSort, string>

/** The files of a library that are episodes, with their show and numbers. */
export const EPISODE_FILES = `
  SELECT m.id AS media_id, m.library_id, m.added_at, m.changed_at, m.bitrate, e.id AS episode_id,
         s.parent_id AS show_id, ${fileWatched('m')} AS watched
    FROM media m
    JOIN libraries l ON l.id = m.library_id
    JOIN media_items mi ON mi.media_id = m.id
    JOIN shown_items e ON e.id = mi.item_id AND e.type = '${ITEM_TYPES.episode}'
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
export const sqlLimit = ({ sort, limit }: SqlLimitProps): number =>
  sort === MEDIA_SORTS.random ? NO_LIMIT : (limit ?? NO_LIMIT)

const YEAR = 'COALESCE(item_year, year)'

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
export const ORDER_BY = {
  [MEDIA_SORTS.title]: BY_TITLE,
  [MEDIA_SORTS.titleDesc]: 'COALESCE(item_sort_title, title) COLLATE NOCASE DESC, id DESC',
  [MEDIA_SORTS.added]: 'added_at DESC, id DESC',
  [MEDIA_SORTS.oldest]: 'added_at, id',
  [MEDIA_SORTS.changed]: 'changed_at DESC, id DESC',
  [MEDIA_SORTS.changedOld]: 'changed_at, id',
  [MEDIA_SORTS.largest]: `size DESC, ${BY_TITLE}`,
  [MEDIA_SORTS.smallest]: `size, ${BY_TITLE}`,
  [MEDIA_SORTS.bitrateHigh]: `bitrate IS NULL, bitrate DESC, ${BY_TITLE}`,
  [MEDIA_SORTS.bitrateLow]: `bitrate IS NULL, bitrate, ${BY_TITLE}`,
  [MEDIA_SORTS.resolutionHigh]: `width * height IS NULL, width * height DESC, ${BY_TITLE}`,
  [MEDIA_SORTS.resolutionLow]: `width * height IS NULL, width * height, ${BY_TITLE}`,
  [MEDIA_SORTS.yearNew]: `${RELEASED} IS NULL, ${RELEASED} DESC, ${BY_TITLE}`,
  [MEDIA_SORTS.yearOld]: `${RELEASED} IS NULL, ${RELEASED}, ${BY_TITLE}`,
  [MEDIA_SORTS.ratingHigh]: `score IS NULL, score DESC, ${BY_TITLE}`,
  [MEDIA_SORTS.ratingLow]: `score IS NULL, score, ${BY_TITLE}`,
  [MEDIA_SORTS.random]: BY_TITLE,
} as const satisfies Record<MediaSort, string>
