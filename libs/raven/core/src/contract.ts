import {
  type Guard,
  type Infer,
  isBoolean,
  isNumber,
  isString,
  isStringArray,
  listOf,
  keyOf,
  nullable,
  object,
  oneOf,
  union,
  exactPartial,
} from '@/schema'
import { MAX_WATCH_TARGETS } from '@/watched'

/**
 * The API contract between the media server and every client. Anything a
 * client renders, or the server returns, is one of these shapes, so the web
 * app and a future native app agree on the wire format by construction.
 *
 * Each shape is written once, as the guard that checks it, and its type is
 * read off the guard. `response.json()` and a request body are both
 * `unknown` until one of these says otherwise, which is what lets every
 * client and the server skip casts entirely.
 */

/**
 * A scan first walks the library's paths for videos, then indexes what it
 * found; `idle` between scans.
 */
export const SCAN_STATES = { idle: 'idle', walking: 'walking', indexing: 'indexing' } as const

export const isScanState = oneOf(Object.values(SCAN_STATES))

export type ScanState = Infer<typeof isScanState>

export const isScanStatus = object({
  state: isScanState,
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
   * reading the files it knows, and never takes over the scan status.
   */
  quickScannedAt: nullable(isString),
  /** The last full scan's failure, cleared when the next scan starts. */
  error: nullable(isString),
})

export type ScanStatus = Infer<typeof isScanStatus>

/** Whether a scan is under way, walking or indexing. */
export const isScanning = (scan: ScanStatus): boolean => scan.state !== 'idle'

export const SORT_DIRECTIONS = { ascending: 'ascending', descending: 'descending' } as const

export type SortDirection = (typeof SORT_DIRECTIONS)[keyof typeof SORT_DIRECTIONS]

/** Every field a library can be sorted on, in the order a menu offers them. */
export const SORT_FIELD_NAMES = {
  title: 'title',
  added: 'added',
  changed: 'changed',
  size: 'size',
  bitrate: 'bitrate',
  resolution: 'resolution',
  release: 'release',
  rating: 'rating',
  random: 'random',
} as const

export const isSortFieldName = oneOf(Object.values(SORT_FIELD_NAMES))

export type SortFieldName = Infer<typeof isSortFieldName>

/** Every sort a listing can be in; `SORT_FIELDS` files each one under its field. */
export const MEDIA_SORTS = {
  title: 'title',
  titleDesc: 'title-desc',
  oldest: 'oldest',
  added: 'added',
  changedOld: 'changed-old',
  changed: 'changed',
  smallest: 'smallest',
  largest: 'largest',
  bitrateLow: 'bitrate-low',
  bitrateHigh: 'bitrate-high',
  resolutionLow: 'resolution-low',
  resolutionHigh: 'resolution-high',
  yearOld: 'year-old',
  yearNew: 'year-new',
  ratingLow: 'rating-low',
  ratingHigh: 'rating-high',
  random: 'random',
} as const

export const isMediaSort = oneOf(Object.values(MEDIA_SORTS))

export type MediaSort = Infer<typeof isMediaSort>

/** A field that runs either way, or one with the one sort. */
export const SORT_FIELD_TYPES = { directed: 'directed', undirected: 'undirected' } as const

/**
 * What a listing is sorted on, each field with its sorts: one for each way a
 * field runs and the way it starts, or the one sort of a field with no way
 * to it. Ascending runs A to Z, oldest, smallest or lowest first; a field
 * starts the way it is most often wanted, newest or biggest first but for
 * titles. `changed` puts the files last found, renamed, moved or replaced
 * first. Resolution ranks by pixel count. `random` shuffles by a seed the
 * client sends, so the order holds across refetches until it deals a new one.
 */
export const SORT_FIELDS = {
  title: {
    type: SORT_FIELD_TYPES.directed,
    ascending: MEDIA_SORTS.title,
    descending: MEDIA_SORTS.titleDesc,
    start: SORT_DIRECTIONS.ascending,
  },
  added: {
    type: SORT_FIELD_TYPES.directed,
    ascending: MEDIA_SORTS.oldest,
    descending: MEDIA_SORTS.added,
    start: SORT_DIRECTIONS.descending,
  },
  changed: {
    type: SORT_FIELD_TYPES.directed,
    ascending: MEDIA_SORTS.changedOld,
    descending: MEDIA_SORTS.changed,
    start: SORT_DIRECTIONS.descending,
  },
  size: {
    type: SORT_FIELD_TYPES.directed,
    ascending: MEDIA_SORTS.smallest,
    descending: MEDIA_SORTS.largest,
    start: SORT_DIRECTIONS.descending,
  },
  size: { type: 'directed', ascending: 'smallest', descending: 'largest', start: 'descending' },
  bitrate: {
    type: SORT_FIELD_TYPES.directed,
    ascending: MEDIA_SORTS.bitrateLow,
    descending: MEDIA_SORTS.bitrateHigh,
    start: SORT_DIRECTIONS.descending,
  },
  resolution: {
    type: SORT_FIELD_TYPES.directed,
    ascending: MEDIA_SORTS.resolutionLow,
    descending: MEDIA_SORTS.resolutionHigh,
    start: SORT_DIRECTIONS.descending,
  },
  release: {
    type: SORT_FIELD_TYPES.directed,
    ascending: MEDIA_SORTS.yearOld,
    descending: MEDIA_SORTS.yearNew,
    start: SORT_DIRECTIONS.descending,
  },
  release: { type: 'directed', ascending: 'year-old', descending: 'year-new', start: 'descending' },
  rating: {
    type: SORT_FIELD_TYPES.directed,
    ascending: MEDIA_SORTS.ratingLow,
    descending: MEDIA_SORTS.ratingHigh,
    start: SORT_DIRECTIONS.descending,
  },
  random: { type: SORT_FIELD_TYPES.undirected, sort: MEDIA_SORTS.random },
} as const satisfies Record<
  SortFieldName,
  | {
      type: typeof SORT_FIELD_TYPES.directed
      ascending: MediaSort
      descending: MediaSort
      start: SortDirection
    }
  | { type: typeof SORT_FIELD_TYPES.undirected; sort: MediaSort }
>

type SortFieldRule = (typeof SORT_FIELDS)[SortFieldName]

/** A field's sorts: one for each way it runs, or the one of a field with no way to it. */
export const fieldSorts = (name: SortFieldName): MediaSort[] => {
  const field: SortFieldRule = SORT_FIELDS[name]
  return field.type === SORT_FIELD_TYPES.directed
    ? [field.ascending, field.descending]
    : [field.sort]
}

export const LIBRARY_VIEWS = {
  grid: 'grid',
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

/** `match` buckets a matched library, of movies or shows, by how far matching got. */
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

export const isLibrary = object({
  id: isNumber,
  name: isString,
  /**
   * Absolute folder paths as the server sees them (container paths under
   * Docker). None while the library is locked to this browser.
   */
  paths: isStringArray,
  /** How each path was read on its last full scan, in path order. None while the library is locked to this browser. */
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
})

export type Library = Infer<typeof isLibrary>

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

export const THUMBNAIL_STATES = { pending: 'pending', ready: 'ready', failed: 'failed' } as const

export const isThumbnailState = oneOf(Object.values(THUMBNAIL_STATES))

export type ThumbnailState = Infer<typeof isThumbnailState>

/**
 * `pending` waits for matching, `matched` found its item by itself,
 * `manual` was chosen with Fix match, `unmatched` found nothing sure, and
 * `off` is a library that is not matched, or an extra.
 */
export const MATCH_STATES = {
  pending: 'pending',
  matched: 'matched',
  manual: 'manual',
  unmatched: 'unmatched',
  off: 'off',
} as const

export const isMatchState = oneOf(Object.values(MATCH_STATES))

export type MatchState = Infer<typeof isMatchState>

export const ITEM_TYPES = {
  movie: 'movie',
  show: 'show',
  season: 'season',
  episode: 'episode',
} as const

export const isItemType = oneOf(Object.values(ITEM_TYPES))

export type ItemType = Infer<typeof isItemType>

/** What Fix match and matching look files up as on TMDB, and what Edit images chooses pictures for. */
export const isMatchItemType = oneOf([ITEM_TYPES.movie, ITEM_TYPES.show])

export type MatchItemType = Infer<typeof isMatchItemType>

/** Rotten Tomatoes and Metacritic are critics; TMDB and IMDb are audiences. */
export const RATING_KINDS = { critic: 'critic', audience: 'audience' } as const

export const isRating = object({
  source: isRatingSource,
  kind: oneOf(Object.values(RATING_KINDS)),
  /** Out of 10. */
  value: isNumber,
  votes: nullable(isNumber),
})

export type Rating = Infer<typeof isRating>

/** What a card needs to show a movie, show, season or episode. */
export const isItemSummary = object({
  id: isNumber,
  type: isItemType,
  title: isString,
  year: nullable(isNumber),
  /** For seasons and episodes: the show they belong to. */
  show: nullable(object({ id: isNumber, title: isString })),
  season: nullable(isNumber),
  episode: nullable(isNumber),
  /** Changes whenever the poster does; null when there is none. */
  posterVersion: nullable(isString),
  /**
   * Changes whenever the backdrop does; null when there is none. A season or
   * an episode has none of its own here.
   */
  backdropVersion: nullable(isString),
  /** Every score it has, one per source. */
  ratings: listOf(isRating),
})

export type ItemSummary = Infer<typeof isItemSummary>

export const isMediaItem = object({
  id: isNumber,
  libraryId: isNumber,
  title: isString,
  fileName: isString,
  /** The folder the file sits in, under the folder its titles sit in (its library path, or a letter or group folder there); '' there. */
  folder: isString,
  size: isNumber,
  /** Normalised from the file extension: 'mp4', 'mkv', 'webm', 'mov', ... */
  container: isString,
  /** Seconds, or null until the file has been probed. */
  duration: nullable(isNumber),
  width: nullable(isNumber),
  height: nullable(isNumber),
  /** ffprobe codec names: 'h264', 'hevc', 'vp9', 'av1', ... */
  videoCodec: nullable(isString),
  videoBitDepth: nullable(isNumber),
  hdr: isBoolean,
  /** ffprobe codec names: 'aac', 'ac3', 'eac3', 'opus', 'truehd', ... */
  audioCodec: nullable(isString),
  audioChannels: nullable(isNumber),
  /** Bits per second across the whole file. */
  bitrate: nullable(isNumber),
  thumbnail: isThumbnailState,
  /** Changes whenever the file does, so a thumbnail URL can be cached forever. */
  thumbnailVersion: isNumber,
  /** Where playback last stopped, in seconds; 0 when never started or finished. */
  position: isNumber,
  favourite: isBoolean,
  /** Whether its card is watched: any of the files on it has a mark, or a play that got to the library's watched percentage. */
  watched: isBoolean,
  addedAt: isString,
  /** When the file last changed on disk: found, renamed, moved or replaced. */
  changedAt: isString,
  /** How far matching got: see `MatchState`. */
  match: isMatchState,
  /** The year the name gives, in a matched library; null elsewhere. */
  year: nullable(isNumber),
  /** Plex's `{edition-...}` from the name. */
  edition: nullable(isString),
  /** The movie or episode this file is, once matched. */
  item: nullable(isItemSummary),
  /**
   * How many files in its library share its card, this one included: the
   * movie's files, or those of its cut once split apart; 1 for anything else.
   */
  versions: isNumber,
  /**
   * What sets its card apart from the movie's others once its files were
   * split apart: its cut, `Final Cut`, else what its name says past the
   * title, `WEBDL-2160p`. Null while it shares the movie's own card, and
   * for anything but a movie.
   */
  variant: nullable(isString),
  /**
   * Which of its movie's cards in its library it sits on once split apart,
   * the same for every file on that card; null on the movie's own card, and
   * for anything but a movie.
   */
  card: nullable(isString),
})

export type MediaItem = Infer<typeof isMediaItem>

export const isMediaList = listOf(isMediaItem)

export const CREDIT_JOBS = {
  cast: 'cast',
  guest: 'guest',
  director: 'director',
  writer: 'writer',
  creator: 'creator',
  producer: 'producer',
} as const

export const isCreditJob = oneOf(Object.values(CREDIT_JOBS))

export type CreditJob = Infer<typeof isCreditJob>

export const isCredit = object({
  personId: isNumber,
  name: isString,
  job: isCreditJob,
  /** The character, or the job in full: "Screenplay", "Novel". */
  role: nullable(isString),
  photoVersion: nullable(isString),
})

export type Credit = Infer<typeof isCredit>

/** A review by a TMDB member, as TMDB hands it on. */
export const isReview = object({
  id: isNumber,
  author: isString,
  /** Changes with the avatar; null when TMDB hosts none. */
  avatarVersion: nullable(isString),
  /** Out of 10, when the author gave one. */
  rating: nullable(isNumber),
  /** Plain text; never rendered as HTML. */
  content: isString,
  /** The review on TMDB. */
  url: isString,
  writtenAt: isString,
})

export type Review = Infer<typeof isReview>

/** A season on its show's page: its card, and how many of its episodes are on disk. */
export const isSeasonSummary = object({
  ...isItemSummary.shape,
  type: oneOf([ITEM_TYPES.season]),
  /** Its episodes with a file this browser may see. */
  episodeCount: isNumber,
  /** Of `episodeCount`, those watched. */
  watchedCount: isNumber,
})

export type SeasonSummary = Infer<typeof isSeasonSummary>

/** An episode on its season's page: what its row shows, and the file Play starts. */
export const isEpisodeSummary = object({
  ...isItemSummary.shape,
  type: oneOf([ITEM_TYPES.episode]),
  summary: nullable(isString),
  released: nullable(isString),
  /** Minutes, from TMDB; the row prefers the file's own length. */
  runtime: nullable(isNumber),
  /** Changes whenever the still does, beside the file or TMDB's; null when there is none. */
  stillVersion: nullable(isString),
  /** Whether any of its files this browser may see is watched; not read off `primary`, whose card for a two-episode file is the first episode's. */
  watched: isBoolean,
  /** The version Play starts, by `primaryVersion`; null when none of its files may be seen. */
  primary: nullable(isMediaItem),
})

export type EpisodeSummary = Infer<typeof isEpisodeSummary>

/** A show's season or a season's episode, as its parent's page lists it. */
export const isItemChild = union(isSeasonSummary, isEpisodeSummary)

export type ItemChild = Infer<typeof isItemChild>

/** Why the AI lookup matched a movie or show it was sure of, in Claude's words. */
export const isAiMatch = object({ reason: isString })

export type AiMatch = Infer<typeof isAiMatch>

/** Everything a movie, show, season or episode page shows. */
export const isItemDetails = object({
  ...isItemSummary.shape,
  tmdbId: isString,
  imdbId: nullable(isString),
  originalTitle: nullable(isString),
  tagline: nullable(isString),
  summary: nullable(isString),
  contentRating: nullable(isString),
  released: nullable(isString),
  ended: nullable(isString),
  /** Minutes, from TMDB; pages prefer the file's own length. */
  runtime: nullable(isNumber),
  studio: nullable(isString),
  genres: isStringArray,
  /** The backdrop's version; for an episode, its still's. */
  backdropVersion: nullable(isString),
  /** The title as TMDB's art, on a clear ground; null when it has none, and for anything but a movie. */
  logoVersion: nullable(isString),
  /**
   * Why the AI lookup matched it, when it did, being sure; null when a
   * search, an id or Fix match did, and for a season or episode.
   */
  aiMatch: nullable(isAiMatch),
  credits: listOf(isCredit),
  /** Reviews by TMDB members, newest first; at most ten. */
  reviews: listOf(isReview),
  /** Every file that is this item, in any library, best first. */
  versions: isMediaList,
  /** A show's seasons, or a season's episodes, on disk, in order; none for a movie or episode. */
  children: listOf(isItemChild),
})

export type ItemDetails = Infer<typeof isItemDetails>

/** A show in a TV shows library's listing. */
export const isShowEntry = object({
  show: isItemSummary,
  /** Distinct episodes on disk. */
  episodes: isNumber,
  /** Of `episodes`, those watched. */
  watchedEpisodes: isNumber,
  /** The year the show ended, or null while it still airs. */
  endedYear: nullable(isNumber),
  /** When its newest file arrived. */
  addedAt: isString,
  /**
   * The mean bitrate of its files in the library, in bits per second, which
   * the bitrate sorts go by; null until one of them is probed.
   */
  bitrate: nullable(isNumber),
  /** The first episode not yet watched by the library's measure, or null when every one is. */
  next: nullable(isMediaItem),
})

export type ShowEntry = Infer<typeof isShowEntry>

/** A TV shows library: its shows, and the files no show was found for. */
export const isShowListing = object({
  shows: listOf(isShowEntry),
  unmatched: isMediaList,
})

export type ShowListing = Infer<typeof isShowListing>

export const HOME_SHELF_TYPES = { shows: 'shows', media: 'media' } as const

/**
 * A library's row on the home page: a pinned library's newest arrivals,
 * newest first, or what a search found in it, by title. A TV shows library
 * gives its shows; any other library gives its videos.
 */
export const isHomeShelf = union(
  object({
    libraryId: isNumber,
    type: oneOf([HOME_SHELF_TYPES.shows]),
    shows: listOf(isShowEntry),
  }),
  object({ libraryId: isNumber, type: oneOf([HOME_SHELF_TYPES.media]), media: isMediaList }),
)

export type HomeShelf = Infer<typeof isHomeShelf>

/**
 * A video, and the item whose poster its card shows: the movie, or an
 * episode's season (else its show); null for a file matched to none.
 */
export const isPosterEntry = object({ media: isMediaItem, poster: nullable(isItemSummary) })

export type PosterEntry = Infer<typeof isPosterEntry>

/**
 * `GET /api/favourites`: every favourite with its poster, most recently
 * marked first. A library's own favourites and videos in progress come the
 * same way.
 */
export const isPosterEntries = listOf(isPosterEntry)

/** How a saga's slideshow moves from one movie's backdrop to the next. */
export const SLIDESHOW_MOTIONS = { fade: 'fade', kenBurns: 'kenBurns', slide: 'slide' } as const

export const isSlideshowMotion = oneOf(Object.values(SLIDESHOW_MOTIONS))

export type SlideshowMotion = Infer<typeof isSlideshowMotion>

export const SAGA_BACKDROP_TYPES = { slideshow: 'slideshow', still: 'still' } as const

/**
 * What a saga's page shows behind its title: its movies' backdrops in turn,
 * first to last and round again, or the one of them picked, held still.
 * `PUT /api/libraries/:id/sagas/:sagaId/backdrop` takes it and answers with it.
 */
export const isSagaBackdrop = union(
  object({ type: oneOf([SAGA_BACKDROP_TYPES.slideshow]), motion: isSlideshowMotion }),
  object({ type: oneOf([SAGA_BACKDROP_TYPES.still]), itemId: isNumber }),
)

export type SagaBackdrop = Infer<typeof isSagaBackdrop>

/** A saga's backdrop until its library picks another. */
export const DEFAULT_SAGA_BACKDROP: SagaBackdrop = {
  type: SAGA_BACKDROP_TYPES.slideshow,
  motion: SLIDESHOW_MOTIONS.fade,
}

/**
 * A saga: a TMDB collection (The Lord of the Rings Collection, say) and the
 * movies of it a library holds, oldest first, one entry each, its best file.
 * The pictures its backdrop shows are read off them by `sagaPictures`.
 */
export const isSaga = object({
  tmdbId: isString,
  name: isString,
  backdrop: isSagaBackdrop,
  media: isMediaList,
})

export type Saga = Infer<typeof isSaga>

/** `GET /api/libraries/:id/sagas`: a library's sagas of two movies or more, by name. */
export const isSagaList = listOf(isSaga)

/** Which cut of a movie a file is, as its name reads. */
export const isFileCut = object({
  /** The cut in the name's own words: `Revisited the Final Cut`. */
  label: isString,
  /** The cut folded, so two namings of one cut agree: `revisited final`. */
  key: isString,
})

export type FileCut = Infer<typeof isFileCut>

/** One file on a card that holds several, and the cut its name reads as; null for the cut most files are. */
export const isDuplicateFile = object({ media: isMediaItem, cut: nullable(isFileCut) })

export type DuplicateFile = Infer<typeof isDuplicateFile>

/** One of a movie's cards: the card as listed, and the files on it, best first. */
export const isDuplicateCard = object({ entry: isPosterEntry, files: listOf(isDuplicateFile) })

export type DuplicateCard = Infer<typeof isDuplicateCard>

/**
 * A movie with more than one file in a library, and the cards they make:
 * one while they share it, more once split apart, the movie's own first.
 */
export const isDuplicate = object({ itemId: isNumber, cards: listOf(isDuplicateCard) })

export type Duplicate = Infer<typeof isDuplicate>

/**
 * `GET /api/libraries/:id/duplicates`: a movie library's movies with more
 * than one file, split apart or not, by title. A split movie stays, so its
 * cards can be put back together.
 */
export const isDuplicates = listOf(isDuplicate)

export type Duplicates = Infer<typeof isDuplicates>

/**
 * How a card's files are split: `apart` gives each its own card; `smart`
 * gives each cut its own, keeping the files of one cut together.
 */
export const SPLIT_HOWS = { apart: 'apart', smart: 'smart' } as const

export const isSplitHow = oneOf(Object.values(SPLIT_HOWS))

export type SplitHow = Infer<typeof isSplitHow>

/** `POST /api/libraries/:id/duplicates/split`: the card, named by any file on it, and how. */
export const isSplitRequest = object({ mediaId: isNumber, how: isSplitHow })

export type SplitRequest = Infer<typeof isSplitRequest>

/** `POST /api/libraries/:id/duplicates/join`: the movie whose files share one card again. */
export const isJoinRequest = object({ itemId: isNumber })

export type JoinRequest = Infer<typeof isJoinRequest>

/** `GET /api/home`: every video in progress, then each pinned library's shelf, as the side menu orders them. */
export const isHome = object({
  /** Videos with a saved spot, the most recently watched first. */
  inProgress: isPosterEntries,
  shelves: listOf(isHomeShelf),
})

export type Home = Infer<typeof isHome>

/**
 * `GET /api/home/search?q=`: a row for each library holding a match, as the
 * side menu orders them, and none for a library with nothing that matches.
 */
export const isHomeSearch = listOf(isHomeShelf)

export type HomeSearch = Infer<typeof isHomeSearch>

/** A person's page: who they are, and everything in raven they are credited on. */
export const isPersonDetails = object({
  id: isNumber,
  name: isString,
  photoVersion: nullable(isString),
  /** Movies and shows on disk, newest first. */
  credits: listOf(object({ item: isItemSummary, job: isCreditJob, role: nullable(isString) })),
})

export type PersonDetails = Infer<typeof isPersonDetails>

/** A logo is the title drawn as art, on a clear ground, for a movie's page. */
export const isItemImageKind = oneOf(['poster', 'backdrop', 'still', 'logo'])

/** The pictures an item can have. */
export type ItemImageKind = Infer<typeof isItemImageKind>

export const ITEM_IMAGE_KINDS = isItemImageKind.values

/**
 * A poster's own width: what it is served at when no width is asked for, and
 * the widest it comes in. `posterSrcSet` lists it at the URL with no width,
 * and the server keeps a poster at it by default, so both read it here.
 */
export const POSTER_OWN_WIDTH = 500

/**
 * The widths a poster comes in, narrowest first, so a card fetches one no
 * wider than it shows. A fixed few, never any number, so the server's cache
 * holds at most these.
 */
export const isPosterWidth = oneOf([185, 342, POSTER_OWN_WIDTH])

export type PosterWidth = Infer<typeof isPosterWidth>

export const POSTER_WIDTHS = isPosterWidth.values

/**
 * The poster width a query's `w` asks for, written as `posterSrcSet` writes
 * it, or null for anything else: another number, or the same one spelled
 * another way.
 */
export const posterWidthFrom = (param: unknown): PosterWidth | null =>
  POSTER_WIDTHS.find((width) => String(width) === param) ?? null

/** Where a picture comes from: a file beside the media, or TMDB. */
export const IMAGE_SOURCES = { local: 'local', tmdb: 'tmdb' } as const

/** One picture a movie or show could show: a file beside the media, or one of TMDB's. */
export const isImageOption = object({
  source: oneOf(Object.values(IMAGE_SOURCES)),
  /** The file's path for `local`; TMDB's path for `tmdb`, served through `imageOptionUrl`. */
  ref: isString,
  width: nullable(isNumber),
  height: nullable(isNumber),
  /** ISO 639-1, or null for a picture with no text. */
  language: nullable(isString),
  /** Whether the item shows this one now. */
  current: isBoolean,
})

export type ImageOption = Infer<typeof isImageOption>

/** Everything a movie or show could show as its poster and backdrop, and a movie as its logo. */
export const isItemImageOptions = object({
  poster: listOf(isImageOption),
  backdrop: listOf(isImageOption),
  /** TMDB's PNG logos; none for a show, whose page shows no logo. */
  logo: listOf(isImageOption),
})

export type ItemImageOptions = Infer<typeof isItemImageOptions>

/** The pictures Edit images can choose: the ones `ItemImageOptions` offers. */
export type ChoosableImageKind = keyof ItemImageOptions

/** What Edit images picks: one of TMDB's pictures, or the one beside the media. */
export const isImageChoice = union(
  object({ source: oneOf([IMAGE_SOURCES.tmdb]), ref: isString }),
  object({ source: oneOf([IMAGE_SOURCES.local]) }),
)

export type ImageChoice = Infer<typeof isImageChoice>

export const DIRECT_PLAYS = { auto: 'auto', force: 'force' } as const

export const TRANSCODINGS = { on: 'on', remuxOnly: 'remuxOnly', off: 'off' } as const

const QUALITIES = { low: 'low', medium: 'medium', high: 'high' } as const

export const HW_ACCELS = {
  auto: 'auto',
  videotoolbox: 'videotoolbox',
  vaapi: 'vaapi',
  none: 'none',
} as const

/** The values each playback setting takes. */
export const PLAYBACK_CHOICES = {
  directPlay: Object.values(DIRECT_PLAYS),
  transcoding: Object.values(TRANSCODINGS),
  maxHeight: [2160, 1080, 720],
  quality: Object.values(QUALITIES),
  hwAccel: Object.values(HW_ACCELS),
} as const

export const isHwAccel = oneOf(PLAYBACK_CHOICES.hwAccel)

/** What encodes a transcode: `auto` takes the GPU the machine has, `none` keeps to the CPU. */
export type HwAccel = Infer<typeof isHwAccel>

/** How the server plays video, set once for every viewer in Settings. */
export const isPlaybackSettings = object({
  /**
   * `auto` plays the original file when the browser takes it and converts
   * otherwise; `force` always sends the original file, for a browser the
   * check underrates.
   */
  directPlay: oneOf(PLAYBACK_CHOICES.directPlay),
  /**
   * `on` remuxes and transcodes as needed; `remuxOnly` never re-encodes
   * video; `off` converts nothing, so only files the browser plays as they
   * are play.
   */
  transcoding: oneOf(PLAYBACK_CHOICES.transcoding),
  /** The frame a transcode is scaled down to. */
  maxHeight: oneOf(PLAYBACK_CHOICES.maxHeight),
  /** How hard a transcode is squeezed: `low` for a slow network, `high` for a big screen. */
  quality: oneOf(PLAYBACK_CHOICES.quality),
  /** What encodes a transcode: `auto` takes the GPU the machine has, `none` keeps to the CPU. */
  hwAccel: isHwAccel,
  /** Whether HDR is tone mapped to SDR on a transcode when the build can. */
  tonemap: isBoolean,
})

export type PlaybackSettings = Infer<typeof isPlaybackSettings>

export const DEFAULT_PLAYBACK_SETTINGS: PlaybackSettings = {
  directPlay: DIRECT_PLAYS.auto,
  transcoding: TRANSCODINGS.on,
  maxHeight: 1080,
  quality: QUALITIES.medium,
  hwAccel: HW_ACCELS.auto,
  tonemap: true,
}

/** A change sends any of the fields; each given must be a value the setting takes. */
export const isPlaybackSettingsChange = exactPartial(isPlaybackSettings.shape)

export const ENCODER_KINDS = {
  software: 'software',
  vaapi: 'vaapi',
  videotoolbox: 'videotoolbox',
} as const

export const isEncoderKind = oneOf(Object.values(ENCODER_KINDS))

/** What transcodes encode with: the CPU, or a GPU through VAAPI or VideoToolbox. */
export type EncoderKind = Infer<typeof isEncoderKind>

/** The settings as kept, with what they come to on this machine. */
export const isPlaybackSettingsState = object({
  settings: isPlaybackSettings,
  effective: object({
    /** What transcodes encode with, after the test encode. */
    encoder: isEncoderKind,
    /** Whether this ffmpeg can tone map at all. */
    tonemapAvailable: isBoolean,
  }),
})

export type PlaybackSettingsState = Infer<typeof isPlaybackSettingsState>

export const TITLE_DISPLAYS = { logo: 'logo', text: 'text' } as const

/** The values each display setting takes. */
export const DISPLAY_CHOICES = {
  titles: Object.values(TITLE_DISPLAYS),
} as const

/** How pages look, set once for every viewer in Settings. */
export const isDisplaySettings = object({
  /** `logo` shows a movie's title as its logo where TMDB has one; `text` always spells it out. */
  titles: oneOf(DISPLAY_CHOICES.titles),
})

export type DisplaySettings = Infer<typeof isDisplaySettings>

export const DEFAULT_DISPLAY_SETTINGS: DisplaySettings = { titles: TITLE_DISPLAYS.logo }

/** A change sends any of the fields; each given must be a value the setting takes. */
export const isDisplaySettingsChange = exactPartial(isDisplaySettings.shape)

export type DisplaySettingsChange = Infer<typeof isDisplaySettingsChange>

/** The fields Edit metadata can write over: what a page shows for a movie or show. */
export const isItemMetadata = object({
  title: isString,
  year: nullable(isNumber),
  tagline: nullable(isString),
  summary: nullable(isString),
  contentRating: nullable(isString),
})

export type ItemMetadata = Infer<typeof isItemMetadata>

/** Edit metadata: what the page shows, what TMDB says, and which fields were written over. */
export const isItemMetadataState = object({
  shown: isItemMetadata,
  original: isItemMetadata,
  overridden: listOf(keyOf(isItemMetadata.shape)),
})

export type ItemMetadataState = Infer<typeof isItemMetadataState>

/** Only known fields, each text, a number for the year, or null; nothing else. */
export const isItemMetadataChange = exactPartial({
  title: nullable(isString),
  year: nullable(isNumber),
  tagline: nullable(isString),
  summary: nullable(isString),
  contentRating: nullable(isString),
} satisfies { [K in keyof ItemMetadata]: Guard<ItemMetadata[K] | null> })

/**
 * What Edit metadata sends: each field given is written over, or cleared
 * back to TMDB's with null. An empty field over TMDB's words is '', or 0 for
 * the year, and shows as nothing; a title cannot be empty.
 */
export type ItemMetadataChange = Infer<typeof isItemMetadataChange>

/** TMDB's ids are digits, which raven keeps as text. */
export const isTmdbId = (value: unknown): value is string => isString(value) && /^\d+$/.test(value)

/** One of TMDB's search results, offered by Fix match. */
export const isMatchCandidate = object({
  tmdbId: isString,
  title: isString,
  year: nullable(isNumber),
  overview: nullable(isString),
  /** TMDB's path for the poster, served through `candidatePosterUrl`. */
  poster: nullable(isString),
  /** How sure Fix match is that this is the folder's or file's movie or show: a whole number from 0 to 100. */
  confidence: isNumber,
})

export type MatchCandidate = Infer<typeof isMatchCandidate>

export const isMatchCandidateList = listOf(isMatchCandidate)

export const MATCH_SUBJECT_KINDS = { media: 'media', item: 'item' } as const

/** What a Fix match search is for: a file (and the show folder it is in), or a matched show. */
export const isMatchSubject = union(
  object({ kind: oneOf([MATCH_SUBJECT_KINDS.media]), id: isNumber }),
  object({ kind: oneOf([MATCH_SUBJECT_KINDS.item]), id: isNumber }),
)

export type MatchSubject = Infer<typeof isMatchSubject>

/** A place inside a library, as the server keeps a group's Fix match: a relative path, never an absolute one. */
export const isLibraryPlace = (value: unknown): value is string =>
  isString(value) && value !== '' && !value.startsWith('/')

/**
 * A movie or show the AI lookup offers for files it was not sure of.
 * Accepting it is a Fix match to `tmdbId`.
 */
export const isAiSuggestion = object({
  tmdbId: isTmdbId,
  title: isString,
  year: nullable(isNumber),
  /** TMDB's path for the poster, served through `candidatePosterUrl`. */
  poster: nullable(isString),
  /** Why Claude thinks so, in a sentence or two. */
  reason: isString,
  /**
   * The group the lookup was asked about: a show's folder, a movie's folder
   * when it holds that one movie, else the movie file's own place.
   */
  place: isLibraryPlace,
})

export type AiSuggestion = Infer<typeof isAiSuggestion>

/** A file no movie or show was found for, as Not matched lists it. */
export const isUnmatchedFile = object({
  ...isMediaItem.shape,
  /** What the AI lookup suggests for its folder; null when it was not asked, chose nothing, or is sure. */
  aiSuggestion: nullable(isAiSuggestion),
})

export type UnmatchedFile = Infer<typeof isUnmatchedFile>

export const isUnmatchedList = listOf(isUnmatchedFile)

/** `off` when not configured, `failing` when the last call went wrong. */
export const METADATA_SERVICE_STATES = { off: 'off', ok: 'ok', failing: 'failing' } as const

export const isMetadataServiceState = oneOf(Object.values(METADATA_SERVICE_STATES))

export type MetadataServiceState = Infer<typeof isMetadataServiceState>

/** How metadata is doing, from `/api/health`. */
export const isMetadataHealth = object({
  tmdb: isMetadataServiceState,
  omdb: isMetadataServiceState,
  /** Files waiting to be matched. */
  pending: isNumber,
  /** Why TMDB is failing, never the token itself. */
  error: nullable(isString),
  /** When TMDB last answered. */
  lastOk: nullable(isString),
  /** The AI lookup: `off` without ANTHROPIC_API_KEY, `failing` when its last call went wrong. */
  ai: isMetadataServiceState,
  /** AI lookups left today; 0 while it is off. */
  aiRemaining: isNumber,
  /** Groups waiting for or in an AI lookup, across libraries; 0 between passes. */
  aiPending: isNumber,
})

export type MetadataHealth = Infer<typeof isMetadataHealth>

export const HEALTH_STATUSES = { ok: 'ok' } as const

/** What `/api/health` answers: the server is up, and how its parts are doing. */
export const isServerHealth = object({
  status: oneOf(Object.values(HEALTH_STATUSES)),
  /** null when ffmpeg is missing, in which case nothing but direct play works. */
  ffmpeg: nullable(isString),
  /** Whether HDR thumbnails and transcodes get tone mapped to SDR. */
  tonemap: isBoolean,
  /** What transcodes encode with: the CPU, or a GPU through VAAPI or VideoToolbox. */
  encoder: isEncoderKind,
  thumbnailsPending: isNumber,
  /** Whether TMDB is configured and answering, and how many files wait to be matched. */
  metadata: isMetadataHealth,
})

export type ServerHealth = Infer<typeof isServerHealth>

/** A video in a library's history: when it last played or was marked, how often it really played, and how far it got. */
export const isHistoryEntry = object({
  media: isMediaItem,
  lastPlayedAt: isString,
  plays: isNumber,
  /** The furthest any play got, in seconds. */
  furthest: isNumber,
  /** Whether a play got to the library's watched percentage, or a mark holds it watched. */
  watched: isBoolean,
  /** Whether Mark as watched holds it watched; `plays` and `furthest` count real plays only. */
  marked: isBoolean,
})

export type HistoryEntry = Infer<typeof isHistoryEntry>

export const isHistory = listOf(isHistoryEntry)

/**
 * Whether locked libraries can be opened here: `available` once the server
 * has a PIN, `unlocked` once this browser has entered it.
 */
export const isLockState = object({
  available: isBoolean,
  unlocked: isBoolean,
})

export type LockState = Infer<typeof isLockState>

export const ADMIN_LOCK_STATES = { on: 'on', turningOn: 'turningOn', off: 'off' } as const

/**
 * The admin lock, as it stands for this browser. It is on until the admin
 * password is entered here, and while it is, locked libraries are left out
 * altogether, no video can be deleted, and no file's path is handed out.
 * `available` once the server has a strong `ADMIN_PASSWORD`, so it can be
 * turned off. Turned back on, it waits `remainingMs` (counted from this
 * answer) before it holds, and until then it goes off again with no password.
 */
export const isAdminLock = union(
  object({ state: oneOf([ADMIN_LOCK_STATES.on]), available: isBoolean }),
  object({ state: oneOf([ADMIN_LOCK_STATES.turningOn]), remainingMs: isNumber }),
  object({ state: oneOf([ADMIN_LOCK_STATES.off]) }),
)

export type AdminLock = Infer<typeof isAdminLock>

/** Where a video's file lives, as the server sees it (a container path under Docker). */
export const isMediaLocation = object({
  path: isString,
})

export type MediaLocation = Infer<typeof isMediaLocation>

export const SERVER_EVENT_TYPES = { library: 'library' } as const

/**
 * What the server tells a client as it happens: a library's videos changed,
 * so whatever shows them should be read again.
 */
export const isServerEvent = object({
  type: oneOf(Object.values(SERVER_EVENT_TYPES)),
  libraryId: isNumber,
})

export type ServerEvent = Infer<typeof isServerEvent>

export const isDirectoryEntry = object({
  name: isString,
  path: isString,
})

export type DirectoryEntry = Infer<typeof isDirectoryEntry>

export const isDirectoryListing = object({
  path: isString,
  /** null at the browse root, where the server will not go any higher. */
  parent: nullable(isString),
  directories: listOf(isDirectoryEntry),
})

export type DirectoryListing = Infer<typeof isDirectoryListing>

export const isAudioTrack = object({
  /** Position among the file's audio tracks, as ffmpeg's `0:a:N` counts them. */
  index: isNumber,
  /** ffprobe codec name: 'aac', 'eac3', 'truehd', ... */
  codec: nullable(isString),
  channels: nullable(isNumber),
  /** Normalised by `languageTag`: 'en' for 'eng', 'English' or 'en-US'; null when untagged. */
  language: nullable(isString),
  title: nullable(isString),
  default: isBoolean,
})

export type AudioTrack = Infer<typeof isAudioTrack>

/** Embedded in the video file, or a file of its own beside it. */
export const SUBTITLE_SOURCES = { embedded: 'embedded', external: 'external' } as const

export const isSubtitleSource = oneOf(Object.values(SUBTITLE_SOURCES))

export type SubtitleSource = Infer<typeof isSubtitleSource>

export const isSubtitleTrack = object({
  /** Stable for the file: `embedded-N` for the Nth subtitle stream, `external-N` for the Nth sidecar. */
  id: isString,
  source: isSubtitleSource,
  /** ffprobe codec name ('subrip', 'ass', 'hdmv_pgs_subtitle', ...), or the sidecar's extension. */
  codec: nullable(isString),
  /** Normalised by `languageTag`, like an audio track's. */
  language: nullable(isString),
  title: nullable(isString),
  default: isBoolean,
  forced: isBoolean,
  hearingImpaired: isBoolean,
  /** Text tracks convert to WebVTT; image tracks (PGS, VobSub, DVB) cannot be shown. */
  supported: isBoolean,
})

export type SubtitleTrack = Infer<typeof isSubtitleTrack>

/** What a player can choose between, read from the file when it is opened. */
export const isMediaTracks = object({
  audio: listOf(isAudioTrack),
  subtitles: listOf(isSubtitleTrack),
  /** The audio track direct play gets: the one flagged default, else the first. */
  defaultAudio: nullable(isNumber),
  /** Frames per second, for stepping a frame at a time. */
  frameRate: nullable(isNumber),
})

export type MediaTracks = Infer<typeof isMediaTracks>

/** How the picture's light is encoded: plain SDR, or one of the HDR formats. */
export const VIDEO_RANGES = {
  sdr: 'sdr',
  hdr10: 'hdr10',
  hlg: 'hlg',
  dolbyVision: 'dolbyVision',
} as const

export const isVideoRange = oneOf(Object.values(VIDEO_RANGES))

export type VideoRange = Infer<typeof isVideoRange>

/** What ffprobe says of the picture beyond what the index keeps. */
export const isVideoStream = object({
  /** ffprobe codec name: 'h264', 'hevc', ... */
  codec: nullable(isString),
  /** The codec's profile as ffprobe names it: 'High', 'Main 10'. */
  profile: nullable(isString),
  /** Bits per second; Matroska says only when its muxer wrote a `BPS` tag. */
  bitrate: nullable(isNumber),
  range: isVideoRange,
})

export type VideoStream = Infer<typeof isVideoStream>

export const isAudioStream = object({
  /** Position among the file's audio tracks, as an `AudioTrack`'s index counts them. */
  index: isNumber,
  codec: nullable(isString),
  /** 'LC', 'DTS-HD MA', 'Dolby TrueHD + Dolby Atmos', ... */
  profile: nullable(isString),
  channels: nullable(isNumber),
  bitrate: nullable(isNumber),
  /** Samples per second: 48000. */
  sampleRate: nullable(isNumber),
})

export type AudioStream = Infer<typeof isAudioStream>

/** A file's picture and sound in detail, read for the player's Playback info. */
export const isMediaStreams = object({
  /** Null for a file with no picture but cover art. */
  video: nullable(isVideoStream),
  audio: listOf(isAudioStream),
})

export type MediaStreams = Infer<typeof isMediaStreams>

/**
 * One subtitle, timed against the file. `text` may hold `<i>`, `<b>` and `<u>`.
 * Read from WebVTT by `parseWebVtt`, never from JSON, so it has no guard.
 */
export type SubtitleCue = {
  start: number
  end: number
  text: string
}

/**
 * How a file reaches the player: the original bytes, a remux with the video
 * copied and the audio converted, or a full conversion of both.
 */
export const PLAYBACK_MODES = { direct: 'direct', remux: 'remux', transcode: 'transcode' } as const

export const isPlaybackMode = oneOf(Object.values(PLAYBACK_MODES))

export type PlaybackMode = Infer<typeof isPlaybackMode>

export const isStreamMode = oneOf([PLAYBACK_MODES.remux, PLAYBACK_MODES.transcode])

/** The two ways the server can convert a file on the fly. */
export type StreamMode = Infer<typeof isStreamMode>

export const STREAM_MODES = isStreamMode.values

/** How far an origin reaches: the home network, the tailnet or the open internet. */
const MEDIA_ORIGIN_KINDS = { lan: 'lan', tailnet: 'tailnet', public: 'public' } as const

export const isMediaOriginKind = oneOf(Object.values(MEDIA_ORIGIN_KINDS))

export type MediaOriginKind = Infer<typeof isMediaOriginKind>

/** One address the browser may fetch media from, straight from the server instead of through the web host's proxy. */
export const isMediaOrigin = object({ kind: isMediaOriginKind, url: isString })

export type MediaOrigin = Infer<typeof isMediaOrigin>

/** What `GET /api/media-origins` returns: the origins raven has, best first. */
export const isMediaOrigins = object({ origins: listOf(isMediaOrigin) })

export type MediaOrigins = Infer<typeof isMediaOrigins>

/** A signed, expiring pass for one media id; `expiresAt` is in epoch seconds. */
export const isMediaTicket = object({ ticket: isString, expiresAt: isNumber })

export type MediaTicket = Infer<typeof isMediaTicket>

/** How long a media ticket is valid. */
export const MEDIA_TICKET_SECONDS = 21_600

/** The player fetches a new ticket this long before the old one expires. */
export const MEDIA_TICKET_REFRESH_SECONDS = 600

/** How many bytes of a file an origin probe reads. */
export const MEDIA_PROBE_BYTES = 262_144

/*
 * Request bodies: what a client sends, checked by the server with the same
 * guard the client's call is typed by.
 */

/** A spot in a file, in seconds from its start. */
const isSeconds = (value: unknown): value is number => isNumber(value) && value >= 0

/** `PUT /api/media/:id/progress`: where playback got to. */
export const isProgressChange = object({
  position: isSeconds,
})

export type ProgressChange = Infer<typeof isProgressChange>

/** `PUT /api/media/:id/favourite`. */
export const isFavouriteChange = object({
  favourite: isBoolean,
})

export type FavouriteChange = Infer<typeof isFavouriteChange>

export const WATCH_TARGET_KINDS = { media: 'media', item: 'item' } as const

/**
 * What `PUT /api/watched` marks: the card a file is on, or every card under
 * an item (a show, season, episode or movie) in one library, or in every
 * library the viewer may see when `libraryId` is null.
 */
export const isWatchTarget = union(
  object({ kind: oneOf([WATCH_TARGET_KINDS.media]), id: isNumber }),
  object({
    kind: oneOf([WATCH_TARGET_KINDS.item]),
    id: isNumber,
    libraryId: nullable(isNumber),
  }),
)

export type WatchTarget = Infer<typeof isWatchTarget>

const isWatchTargets = (value: unknown): value is WatchTarget[] =>
  listOf(isWatchTarget)(value) && value.length > 0 && value.length <= MAX_WATCH_TARGETS

/** `PUT /api/watched`: mark every target, from one to `MAX_WATCH_TARGETS`, watched or unwatched. */
export const isWatchedChange = object({
  watched: isBoolean,
  targets: isWatchTargets,
})

export type WatchedChange = Infer<typeof isWatchedChange>

/** `POST /api/lock/unlock`: the PIN that opens every locked library. */
export const isUnlockRequest = object({
  pin: isString,
})

export type UnlockRequest = Infer<typeof isUnlockRequest>

/** `POST /api/admin/unlock`: the admin password, which turns the admin lock off in this browser. */
export const isAdminUnlockRequest = object({
  password: isString,
})

export type AdminUnlockRequest = Infer<typeof isAdminUnlockRequest>

/** `PUT /api/media/:id/match`: a TMDB id for Fix match, or null for a file that is not one at all. */
export const isMatchChoice = object({
  tmdbId: nullable(isTmdbId),
})

export type MatchChoice = Infer<typeof isMatchChoice>

/** `PUT /api/items/:id/match`: the TMDB show to point a show's files at. */
export const isShowMatchChoice = object({
  tmdbId: isTmdbId,
})

export type ShowMatchChoice = Infer<typeof isShowMatchChoice>
