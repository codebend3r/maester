import { isMediaSort } from '@/contract/sorting'
import {
  type Infer,
  exactPartial,
  isBoolean,
  isNumber,
  isString,
  isStringArray,
  listOf,
  nullable,
  object,
  oneOf,
  union,
} from '@/schema'

/**
 * A scan first walks the library's paths for videos, then indexes what it
 * found; a quick scan the admin started then waits while the new videos are
 * matched; `idle` between scans.
 */
export const SCAN_STATES = {
  idle: 'idle',
  walking: 'walking',
  indexing: 'indexing',
  matching: 'matching',
} as const

export const isScanState = oneOf(Object.values(SCAN_STATES))

export type ScanState = Infer<typeof isScanState>

/** Which scan the status is of: one that reads every file, or one that takes in what is new. */
export const SCAN_KINDS = { full: 'full', quick: 'quick' } as const

export const isScanKind = oneOf(Object.values(SCAN_KINDS))

export type ScanKind = Infer<typeof isScanKind>

export const isScanStatus = object({
  state: isScanState,
  /** The scan under way, or the last one to run; a quick scan takes in new, renamed and deleted files. */
  kind: isScanKind,
  /**
   * Video files found under the library's paths: climbing while the walk
   * looks, as a big share takes minutes, then all of them.
   */
  found: isNumber,
  /** Files already indexed: unchanged ones count straight away, new and changed ones once probed. */
  processed: isNumber,
  startedAt: nullable(isString),
  /** When the last full scan finished, kept across restarts; null before any. */
  finishedAt: nullable(isString),
  /**
   * When the last quick scan finished, kept across restarts; null before
   * any. A quick scan takes in new, renamed and deleted files without
   * reading the files it knows, and leaves the full scan's time alone.
   */
  quickScannedAt: nullable(isString),
  /** The last full scan's failure, cleared when the next scan starts. */
  error: nullable(isString),
})

export type ScanStatus = Infer<typeof isScanStatus>

/** Whether a scan is under way: walking, indexing or matching. */
export const isScanning = (scan: ScanStatus): boolean => scan.state !== SCAN_STATES.idle

export const LIBRARY_VIEWS = {
  grid: 'grid',
  covers: 'covers',
  list: 'list',
  tiles: 'tiles',
  grouped: 'grouped',
} as const

export const isLibraryView = oneOf(Object.values(LIBRARY_VIEWS))

export type LibraryView = Infer<typeof isLibraryView>

export const LIBRARY_KINDS = {
  movies: 'movies',
  shows: 'shows',
  animeMovies: 'animeMovies',
  animeShows: 'animeShows',
  familyMovies: 'familyMovies',
  familyShows: 'familyShows',
  documentaries: 'documentaries',
  sports: 'sports',
  youtube: 'youtube',
  other: 'other',
} as const

export const isLibraryKind = oneOf(Object.values(LIBRARY_KINDS))

export type LibraryKind = Infer<typeof isLibraryKind>

/**
 * The icons a library can wear, in the order Edit library offers them:
 * films and shows, then sport, then audio. Each type wears one of them
 * until its library picks another; the web app draws them.
 */
const LIBRARY_ICON_NAMES = {
  film: 'film',
  tv: 'tv',
  filmSpark: 'filmSpark',
  tvSpark: 'tvSpark',
  filmHeart: 'filmHeart',
  tvHeart: 'tvHeart',
  globe: 'globe',
  tvGlobe: 'tvGlobe',
  fourK: 'fourK',
  musicVideo: 'musicVideo',
  youtube: 'youtube',
  video: 'video',
  standUp: 'standUp',
  gamepad: 'gamepad',
  trophy: 'trophy',
  octagon: 'octagon',
  basketball: 'basketball',
  soccer: 'soccer',
  americanFootball: 'americanFootball',
  headphones: 'headphones',
  music: 'music',
  disc: 'disc',
  podcast: 'podcast',
  audiobook: 'audiobook',
} as const

export const isLibraryIconName = oneOf(Object.values(LIBRARY_ICON_NAMES))

export type LibraryIconName = Infer<typeof isLibraryIconName>

/** `match` buckets a matched library, of movies or shows, by how far matching got. */
export const MEDIA_GROUPINGS = {
  match: 'match',
  resolution: 'resolution',
  codec: 'codec',
  month: 'month',
} as const

export const isMediaGroupBy = oneOf(Object.values(MEDIA_GROUPINGS))

export type MediaGroupBy = Infer<typeof isMediaGroupBy>

export const RATING_SOURCES = {
  tmdb: 'tmdb',
  imdb: 'imdb',
  rottenTomatoes: 'rottenTomatoes',
  metacritic: 'metacritic',
} as const

export const isRatingSource = oneOf(Object.values(RATING_SOURCES))

export type RatingSource = Infer<typeof isRatingSource>

/**
 * How a library's folders are read: `auto` reads letter folders (`A/`, `#/`)
 * and group folders (`Requests/`) as holding the titles; `flat` reads every
 * top folder as one title.
 */
export const FOLDER_LAYOUTS = { auto: 'auto', flat: 'flat' } as const

export const isFolderLayout = oneOf(Object.values(FOLDER_LAYOUTS))

export type FolderLayout = Infer<typeof isFolderLayout>

/** What a library path turned out to be on its last full scan. */
export const PATH_LAYOUTS = { flat: 'flat', lettered: 'lettered', grouped: 'grouped' } as const

export const isPathLayout = oneOf(Object.values(PATH_LAYOUTS))

export type PathLayout = Infer<typeof isPathLayout>

/** One library path, how it was read, and how many group folders it holds. */
export const isLibraryPathLayout = object({
  path: isString,
  /** null until a full scan has read the path. */
  layout: nullable(isPathLayout),
  groups: isNumber,
})

export type LibraryPathLayout = Infer<typeof isLibraryPathLayout>

/** A whole percentage from 1 to 100. */
export const isWatchedPercent = (value: unknown): value is number =>
  isNumber(value) && Number.isInteger(value) && value >= 1 && value <= 100

/** How a library behaves, each one set per library. */
export const isLibrarySettings = object({
  /** Remember where each video stopped and resume there. Off keeps saved spots without using them. */
  saveProgress: isBoolean,
  /** Give the library its own link in the side menu. */
  pinned: isBoolean,
  /** Let home's hero show its titles, the newest releases and the admin's picks alike. */
  inHero: isBoolean,
  /** The order its videos are listed in. */
  sort: isMediaSort,
  /** How its videos are laid out: cards, a table, tiles, or cards in groups. */
  view: isLibraryView,
  /** What the grouped view buckets videos by. */
  groupBy: isMediaGroupBy,
  /** How far into a video, as a whole percentage, a play must get for it to count as watched. */
  watchedPercent: isWatchedPercent,
  /** What the library holds: movies, TV shows, anime movies or shows, sporting events, YouTube videos, or anything else. */
  kind: isLibraryKind,
  /** Whose score its cards show and its rating sorts use; TMDB's stands in where that source has none. */
  ratingsSource: isRatingSource,
  /** Watch the folders and take in videos added, removed, renamed or replaced there as it happens. */
  autoRefresh: isBoolean,
  /** Private, whatever its type: its videos stay hidden until the server's PIN is entered. */
  locked: isBoolean,
  /** Read letter and group folders as holding the titles (`auto`), or every top folder as one title (`flat`). */
  folderLayout: isFolderLayout,
  /** The icon it wears in the side menu, on its page and on Libraries; null wears its type's. */
  icon: nullable(isLibraryIconName),
})

export type LibrarySettings = Infer<typeof isLibrarySettings>

/** Some of a library's settings, each a value it takes, and nothing else. */
export const isLibrarySettingsChange = exactPartial(isLibrarySettings.shape)

/**
 * How a library is laid out, and its pin: the settings any viewer may
 * change, with the admin lock on or off. Everything else of a library, its
 * name and folders included, is an admin's `LibraryInput`.
 */
export const isLibraryViewChange = exactPartial({
  sort: isLibrarySettings.shape.sort,
  view: isLibrarySettings.shape.view,
  groupBy: isLibrarySettings.shape.groupBy,
  pinned: isLibrarySettings.shape.pinned,
})

export type LibraryViewChange = Infer<typeof isLibraryViewChange>

/** `PUT /api/libraries/:id/hero`: whether the library's titles may show in home's hero. */
export const isLibraryHeroChange = object({ inHero: isLibrarySettings.shape.inHero })

export type LibraryHeroChange = Infer<typeof isLibraryHeroChange>

/** `PUT /api/libraries/order`: every library's id, once each, in the order they should list. */
export const isLibraryOrder = object({ ids: listOf(isNumber) })

export type LibraryOrder = Infer<typeof isLibraryOrder>

export const LIBRARY_BACKDROP_TYPES = { item: 'item', thumbnail: 'thumbnail' } as const

/**
 * The picture that stands for a library's newest video: the backdrop of its
 * movie or show (an episode's comes from its show), else the video's own
 * thumbnail. `item` names the movie or show, `thumbnail` the video.
 */
export const isLibraryBackdrop = union(
  object({ type: oneOf([LIBRARY_BACKDROP_TYPES.item]), id: isNumber, version: isString }),
  object({ type: oneOf([LIBRARY_BACKDROP_TYPES.thumbnail]), id: isNumber, version: isNumber }),
)

export type LibraryBackdrop = Infer<typeof isLibraryBackdrop>

/**
 * Where a library's Refresh of its ratings stands: `idle`, with when the
 * last one finished; `running`, with how many of the titles it asked for
 * are done; or `waiting`, for a source's calls to come back at midnight UTC
 * (`budget`) or for a source to answer again (`unavailable`).
 */
export const RATINGS_REFRESH_STATES = {
  idle: 'idle',
  running: 'running',
  waiting: 'waiting',
} as const

export const isRatingsRefresh = union(
  object({ state: oneOf([RATINGS_REFRESH_STATES.idle]), finishedAt: nullable(isString) }),
  object({
    state: oneOf([RATINGS_REFRESH_STATES.running]),
    done: isNumber,
    total: isNumber,
    startedAt: isString,
  }),
  object({
    state: oneOf([RATINGS_REFRESH_STATES.waiting]),
    done: isNumber,
    total: isNumber,
    startedAt: isString,
    reason: oneOf(['budget', 'unavailable']),
    resumesAt: isString,
  }),
)

export type RatingsRefresh = Infer<typeof isRatingsRefresh>

export const isLibrary = object({
  id: isNumber,
  name: isString,
  /**
   * Absolute folder paths as the server sees them (container paths under
   * Docker). None while the library is locked to this browser, and none
   * while the admin lock holds: only the admin sees where files live.
   */
  paths: isStringArray,
  /** How each path was read on its last full scan, in path order. None while the library is locked to this browser or the admin lock holds. */
  layouts: listOf(isLibraryPathLayout),
  itemCount: isNumber,
  /** Files no movie or show was found for; 0 in a library that is not matched. */
  unmatchedCount: isNumber,
  createdAt: isString,
  /** While the library is locked to this browser, a failure says only that there was one. */
  scan: isScanStatus,
  settings: isLibrarySettings,
  /** null when no video has a picture yet, or while the library is locked to this browser. */
  backdrop: nullable(isLibraryBackdrop),
  ratingsRefresh: isRatingsRefresh,
})

export type Library = Infer<typeof isLibrary>

/** Whether a library's missing ratings are being fetched, or are waiting to be. */
export const isRefreshingRatings = (library: Library): boolean =>
  library.ratingsRefresh.state !== 'idle'

export const isLibraryList = listOf(isLibrary)

/**
 * What a client sends to create a library or replace its name and paths.
 * Settings left out keep their defaults on create and their current values
 * on update, so a client can change one without knowing the rest.
 * `validateLibraryInput` checks it, with a reason for each problem.
 */
export type LibraryInput = {
  name: string
  paths: string[]
  settings?: Partial<LibrarySettings>
}
