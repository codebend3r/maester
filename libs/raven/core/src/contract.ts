import {
  type Guard,
  type Infer,
  isBoolean,
  isNumber,
  isRecord,
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

export const MEMBER_STATUSES = {
  pending: 'pending',
  approved: 'approved',
  revoked: 'revoked',
} as const
export const isMemberStatus = oneOf(Object.values(MEMBER_STATUSES))

export const AUTH_CONFIG_STATES = {
  off: 'off',
  unavailable: 'unavailable',
  ready: 'ready',
} as const
export const AUTH_COOKIE = 'maester-auth'
/** The cookie the library PIN's unlock sets, under `UNLOCK_COOKIE_PATH`, naming the account that entered it. */
export const UNLOCK_COOKIE = 'raven_unlock'
export const UNLOCK_COOKIE_PATH = '/api'
export const AUTH_HEADERS = {
  authorization: 'authorization',
  cookie: 'cookie',
  apiKey: 'apikey',
} as const
export const AUTH_SCHEME = 'Bearer'
export const AUTH_API_PREFIX = '/api/'
export const AUTH_METHODS = { get: 'GET', head: 'HEAD', post: 'POST' } as const
/** The query key a media ticket travels in, on the file and sidecar URLs. */
export const MEDIA_TICKET_PARAM = 't'
export const AUTH_PARAMS = { id: 'id', pageSize: 'pageSize', pageOffset: 'pageOffset' } as const
export const AUTH_PATHS = {
  config: '/api/auth/config',
  me: '/api/me',
  members: '/api/auth/members',
  memberStatus: '/api/auth/members/:id/status',
  ticket: '/api/auth/media/:id/ticket',
} as const
export const AUTH_ROUTES = {
  signIn: '/sign-in',
  signUp: '/sign-up',
  checkEmail: '/check-email',
  confirm: '/auth/confirm',
  forgot: '/forgot-password',
  reset: '/reset-password',
  pending: '/pending',
} as const

export const isAccountId = (value: unknown): value is string =>
  isString(value) && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)

export const isAuthConfig = union(
  object({ state: oneOf([AUTH_CONFIG_STATES.off, AUTH_CONFIG_STATES.unavailable]) }),
  object({
    state: oneOf([AUTH_CONFIG_STATES.ready]),
    supabaseUrl: isString,
    publishableKey: isString,
    webUrl: isString,
    cookieName: oneOf([AUTH_COOKIE]),
  }),
)
export type AuthConfig = Infer<typeof isAuthConfig>

export const isAccount = object({
  id: isAccountId,
  email: isString,
  status: isMemberStatus,
  isOwner: isBoolean,
})
export type Account = Infer<typeof isAccount>
export const isAccountList = listOf(isAccount)
export const isMemberStatusChange = object({
  status: oneOf([MEMBER_STATUSES.approved, MEMBER_STATUSES.revoked]),
})
export type MemberStatusChange = Infer<typeof isMemberStatusChange>

export const AUTH_REFUSALS = {
  signedOut: 'signed_out',
  pending: 'pending',
  revoked: 'revoked',
  notOwner: 'not_owner',
  unavailable: 'unavailable',
} as const
export const isAuthRefusal = object({
  reason: oneOf(Object.values(AUTH_REFUSALS)),
  message: isString,
})
export type AuthRefusal = Infer<typeof isAuthRefusal>

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
export const isScanning = (scan: ScanStatus): boolean => scan.state !== SCAN_STATES.idle

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

/** Whether a library's ratings are being fetched again, or are waiting to be. */
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
  /** The title as TMDB's art, on a clear ground; null when it has none, and for a season or episode. */
  logoVersion: nullable(isString),
  /**
   * Whether a show or season is a favourite; null where it cannot be one: a
   * movie or episode, whose files are favourites instead, or one only locked
   * libraries hold.
   */
  favourite: nullable(isBoolean),
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

/**
 * `GET /api/favourites/titles`: every show and season marked a favourite,
 * most recently marked first. Videos are favourites by file, in
 * `GET /api/favourites`.
 */
export const isFavouriteTitles = listOf(isItemSummary)

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

/** What TMDB says of a person; every field is null when it has nothing. */
export const isPersonProfile = object({
  imdbId: nullable(isString),
  /** `YYYY-MM-DD`. */
  birthday: nullable(isString),
  /** `YYYY-MM-DD`. */
  deathday: nullable(isString),
  placeOfBirth: nullable(isString),
  biography: nullable(isString),
  knownFor: nullable(isString),
})

export type PersonProfile = Infer<typeof isPersonProfile>

/** The kind of work a credit is: TMDB's departments, folded to the ones a filmography tabs by. */
export const isFilmographyDepartment = oneOf([
  'acting',
  'directing',
  'writing',
  'producing',
  'crew',
])

export type FilmographyDepartment = Infer<typeof isFilmographyDepartment>

/** One part a person played in a title; a title can hold several. */
export const isFilmographyCredit = object({
  department: isFilmographyDepartment,
  role: nullable(isString),
  /** How many episodes of a show the credit covers, when TMDB says. */
  episodes: nullable(isNumber),
  /** Whether they appear as themselves, as on a talk show. */
  isSelf: isBoolean,
})

export type FilmographyCredit = Infer<typeof isFilmographyCredit>

/** A movie or show a person is credited on in TMDB, and the item in raven when it holds one. */
export const isFilmographyEntry = object({
  type: isMatchItemType,
  tmdbId: isString,
  title: isString,
  year: nullable(isNumber),
  /** `YYYY-MM-DD`, or the part TMDB knows. */
  released: nullable(isString),
  /** TMDB's poster path, served through `/api/images/poster`. */
  poster: nullable(isString),
  credits: listOf(isFilmographyCredit),
  item: nullable(isItemSummary),
})

export type FilmographyEntry = Infer<typeof isFilmographyEntry>

/**
 * A person's whole TMDB filmography: `ready` with its entries, `pending`
 * while the server fetches it, or `unavailable` when TMDB is not configured
 * or cannot be reached.
 */
export const isPersonFilmography = union(
  object({
    state: oneOf(['ready']),
    fetchedAt: isString,
    entries: listOf(isFilmographyEntry),
  }),
  object({ state: oneOf(['pending']) }),
  object({ state: oneOf(['unavailable']) }),
)

export type PersonFilmography = Infer<typeof isPersonFilmography>

/** A person's page: who they are, and everything in raven they are credited on. */
export const isPersonDetails = object({
  id: isNumber,
  tmdbId: isString,
  name: isString,
  photoVersion: nullable(isString),
  profile: nullable(isPersonProfile),
  filmography: isPersonFilmography,
  /** Movies and shows on disk, newest first. */
  credits: listOf(object({ item: isItemSummary, job: isCreditJob, role: nullable(isString) })),
})

export type PersonDetails = Infer<typeof isPersonDetails>

/** A logo is the title drawn as art, on a clear ground, for a movie's or show's page. */
export const ITEM_IMAGE_KINDS = {
  poster: 'poster',
  backdrop: 'backdrop',
  still: 'still',
  logo: 'logo',
} as const

export const isItemImageKind = oneOf(Object.values(ITEM_IMAGE_KINDS))

/** The pictures an item can have. */
export type ItemImageKind = Infer<typeof isItemImageKind>

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

/** Everything a movie or show could show as its poster, backdrop and logo. */
export const isItemImageOptions = object({
  poster: listOf(isImageOption),
  backdrop: listOf(isImageOption),
  /** TMDB's PNG logos. */
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
  /** `logo` shows a movie's or show's title as its logo where TMDB has one; `text` always spells it out. */
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

/** A TV documentary kept as a movie uses a separate namespace from TMDB's movie ids. */
export const TMDB_MATCH_PREFIXES = { tvMovie: 'tv:' } as const

export const isTvMovieId = (
  value: unknown,
): value is `${typeof TMDB_MATCH_PREFIXES.tvMovie}${string}` =>
  isString(value) &&
  value.startsWith(TMDB_MATCH_PREFIXES.tvMovie) &&
  isTmdbId(value.slice(TMDB_MATCH_PREFIXES.tvMovie.length))

/** A movie or show match, including a TV documentary watched as one movie. */
export const isMatchId = (value: unknown): value is string => isTmdbId(value) || isTvMovieId(value)

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
  tmdbId: isMatchId,
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
  mdblist: isMetadataServiceState,
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

/**
 * The sizes a viewer can ask a transcode for: the frame it is scaled down
 * to and the bitrate it is held under, in bits per second.
 */
export const STREAM_QUALITIES = {
  high1080: { label: '1080p HD (High)', height: 1080, bitrate: 20_000_000 },
  medium1080: { label: '1080p HD (Medium)', height: 1080, bitrate: 12_000_000 },
  standard1080: { label: '1080p HD (Standard)', height: 1080, bitrate: 10_000_000 },
  low1080: { label: '1080p HD (Low)', height: 1080, bitrate: 8_000_000 },
  high720: { label: '720p HD (High)', height: 720, bitrate: 4_000_000 },
  medium720: { label: '720p HD (Medium)', height: 720, bitrate: 3_000_000 },
  low720: { label: '720p HD', height: 720, bitrate: 2_000_000 },
  sd480: { label: '480p', height: 480, bitrate: 1_500_000 },
  mobile328: { label: '328p', height: 328, bitrate: 700_000 },
} as const satisfies Record<string, { label: string; height: number; bitrate: number }>

const keysOf = <K extends string>(record: Record<K, unknown>): K[] =>
  Object.keys(record).filter((key): key is K => key in record)

export const isStreamQuality = oneOf(keysOf(STREAM_QUALITIES))

export type StreamQuality = Infer<typeof isStreamQuality>

/** How far an origin reaches: the home network, the tailnet or the open internet. */
export const MEDIA_ORIGIN_KINDS = { lan: 'lan', tailnet: 'tailnet', public: 'public' } as const

export const isMediaOriginKind = oneOf(Object.values(MEDIA_ORIGIN_KINDS))

export type MediaOriginKind = Infer<typeof isMediaOriginKind>

/** One address the browser may fetch media from, straight from the server instead of through the web host's proxy. */
export const isMediaOrigin = object({ kind: isMediaOriginKind, url: isString })

export type MediaOrigin = Infer<typeof isMediaOrigin>

/** What `GET /api/media-origins` returns: the origins raven has, best first. */
export const isMediaOrigins = object({ origins: listOf(isMediaOrigin) })

export type MediaOrigins = Infer<typeof isMediaOrigins>

/** A signed, expiring pass for one media id; `expiresAt` is in epoch milliseconds. */
export const isMediaTicket = object({ ticket: isString, expiresAt: isNumber })

export type MediaTicket = Infer<typeof isMediaTicket>

/** How long a media ticket is valid. */
export const MEDIA_TICKET_SECONDS = 21_600

/** How long an account ticket is valid, at most: it never outlives the token it was minted with. */
export const ACCOUNT_TICKET_SECONDS = 300

/** The HLS routes, with the same `:name` placeholders the client fills in. */
export const HLS_PATHS = {
  master: '/api/media/:id/hls/master.m3u8',
  video: '/api/media/:id/hls/:session/video.m3u8',
  init: '/api/media/:id/hls/:session/init',
  segment: '/api/media/:id/hls/:session/segment/:n',
  subtitles: '/api/media/:id/hls/:session/subtitles/:trackId',
  subtitleSegment: '/api/media/:id/hls/:session/subtitles/:trackId/:n',
} as const

/** The placeholder names in `HLS_PATHS` and the master playlist's query keys; every HLS URI also carries the `MEDIA_TICKET_PARAM`. */
export const HLS_PARAMS = {
  id: 'id',
  session: 'session',
  n: 'n',
  trackId: 'trackId',
  mode: 'mode',
  audio: 'audio',
  quality: 'quality',
} as const

/** How long a segment lasts, in seconds; a remux stretches it to the next keyframe. */
export const HLS_SEGMENT_SECONDS = 6

/** The longest stretch between two keyframes a remux accepts, in seconds. */
export const HLS_MAX_KEYFRAME_GAP_SECONDS = 20

/** How long a session may go unasked before the server stops its run and deletes its segments, in milliseconds. */
export const HLS_IDLE_MS = 60_000

/** How many of a session's latest segments stay on disk. */
export const HLS_KEPT_SEGMENTS = 30

/** The audio codecs an HLS stream copies; any other becomes E-AC-3. */
export const HLS_COPY_AUDIO = ['aac', 'ac3', 'eac3', 'alac', 'flac'] as const

/** A session id is 16 random bytes in base64url without padding. */
export const isHlsSessionId = (value: unknown): value is string =>
  isString(value) && /^[A-Za-z0-9_-]{22}$/.test(value)

/**
 * A video the server is sending to one browser or device right now, as the
 * admin's Streams page lists it. `browser` and `device` are read from the
 * User-Agent header, so they are the client's own word for itself;
 * `address` is where the requests came from, which behind a proxy is the
 * address the proxy forwards. `position` is the last spot the player
 * reported, in seconds, and null until it reports one.
 */
export const isLiveStream = object({
  id: isString,
  media: isMediaItem,
  libraryName: isString,
  mode: isPlaybackMode,
  browser: isString,
  device: isString,
  address: isString,
  startedAt: isString,
  lastSeenAt: isString,
  position: nullable(isNumber),
  /** The signed-in account's email; null on a server without accounts. */
  viewer: nullable(isString),
  /**
   * The audio track playing, by its place among the file's: the one a
   * converted stream asked for, then the one the player reports. Null until
   * either says.
   */
  audio: nullable(isNumber),
  /** Bits per second the server sent over the last few seconds; null until it has looked twice. */
  sendRate: nullable(isNumber),
  /** The size the viewer asked a transcode for; null for the server's own settings and for the other modes. */
  quality: nullable(isStreamQuality),
})

export type LiveStream = Infer<typeof isLiveStream>

export const isLiveStreamList = listOf(isLiveStream)

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

/** An audio track's place among the file's, as ffmpeg's `0:a:N` counts them. */
const isTrackIndex = (value: unknown): value is number =>
  isNumber(value) && Number.isInteger(value) && value >= 0

/**
 * The same route from a player that names what it plays: the position, and
 * the audio track playing, or null when it cannot tell. A body without
 * `audio` is an older player's `ProgressChange`.
 */
export const isProgressReport = object({
  ...isProgressChange.shape,
  audio: nullable(isTrackIndex),
})

export type ProgressReport = Infer<typeof isProgressReport>

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
  tmdbId: nullable(isMatchId),
})

export type MatchChoice = Infer<typeof isMatchChoice>

/** `PUT /api/items/:id/match`: the TMDB show to point a show's files at. */
export const isShowMatchChoice = object({
  tmdbId: isTmdbId,
})

export type ShowMatchChoice = Infer<typeof isShowMatchChoice>

/*
 * Bug reports: what a viewer's player sends when a video will not play, and
 * what the admin reads back to track each one.
 */

/** Where a report stands; every one starts `new`. */
export const BUG_REPORT_STATUSES = {
  new: 'new',
  investigating: 'investigating',
  fixed: 'fixed',
  wontFix: 'wont_fix',
} as const

export const isBugReportStatus = oneOf(Object.values(BUG_REPORT_STATUSES))

export type BugReportStatus = Infer<typeof isBugReportStatus>

export const BUG_REPORT_PARAMS = { id: 'id' } as const

export const BUG_REPORT_PATHS = {
  reports: '/api/reports',
  status: '/api/reports/:id/status',
} as const

/** The most a report's body may weigh as JSON; the server refuses anything heavier. */
export const MAX_BUG_REPORT_BYTES = 65_536

const isPixelSize = object({ width: isNumber, height: isNumber })

/** One way of playing that was tried and failed, with what the picture was doing then. */
export const isPlaybackAttempt = object({
  mode: isPlaybackMode,
  message: isString,
  /** Seconds into the file; null when the picture never had a time. */
  position: nullable(isNumber),
  /** The size of the frames being decoded, when any were. */
  frame: nullable(isPixelSize),
  frames: nullable(object({ dropped: isNumber, total: isNumber })),
})

export type PlaybackAttempt = Infer<typeof isPlaybackAttempt>

/** A MIME type the browser was asked about, and its answer. */
export const isCodecSupport = object({ type: isString, isSupported: isBoolean })

export type CodecSupport = Infer<typeof isCodecSupport>

/** The browser and machine a report came from; null where the browser does not say. */
export const isDeviceFacts = object({
  userAgent: isString,
  /** `navigator.userAgentData`'s brands, as "Chromium 141". */
  brands: nullable(isStringArray),
  isMobile: nullable(isBoolean),
  platform: nullable(isString),
  language: nullable(isString),
  languages: isStringArray,
  screen: nullable(isPixelSize),
  viewport: nullable(isPixelSize),
  pixelRatio: nullable(isNumber),
  cores: nullable(isNumber),
  /** Gigabytes, rounded by the browser. */
  memory: nullable(isNumber),
  connection: nullable(
    object({
      type: nullable(isString),
      effectiveType: nullable(isString),
      /** Megabits per second. */
      downlink: nullable(isNumber),
      /** Milliseconds. */
      rtt: nullable(isNumber),
      saveData: nullable(isBoolean),
    }),
  ),
  isOnline: isBoolean,
  timeZone: nullable(isString),
})

export type DeviceFacts = Infer<typeof isDeviceFacts>

/** The file's facts a report carries, each checked as the media's own. */
const MEDIA_SHAPE = isMediaItem.shape

/**
 * `POST /api/reports`: everything a player knew when it gave up, gathered
 * in the browser at the press of Report this error. It never holds a media
 * ticket or a token: addresses go without their query.
 */
export const isPlaybackDiagnostics = object({
  /** The title as the player showed it. */
  title: isString,
  /** What the error screen listed, the failure first. */
  problems: isStringArray,
  media: nullable(
    object({
      id: MEDIA_SHAPE.id,
      libraryId: MEDIA_SHAPE.libraryId,
      fileName: MEDIA_SHAPE.fileName,
      container: MEDIA_SHAPE.container,
      size: MEDIA_SHAPE.size,
      duration: MEDIA_SHAPE.duration,
      width: MEDIA_SHAPE.width,
      height: MEDIA_SHAPE.height,
      videoCodec: MEDIA_SHAPE.videoCodec,
      videoBitDepth: MEDIA_SHAPE.videoBitDepth,
      hdr: MEDIA_SHAPE.hdr,
      audioCodec: MEDIA_SHAPE.audioCodec,
      audioChannels: MEDIA_SHAPE.audioChannels,
      bitrate: MEDIA_SHAPE.bitrate,
    }),
  ),
  tracks: object({
    audio: nullable(isAudioTrack),
    subtitle: nullable(isSubtitleTrack),
    audioCount: nullable(isNumber),
    subtitleCount: nullable(isNumber),
  }),
  /** Null for a player with no ladder, such as a local file's. */
  playback: nullable(
    object({
      /** The ways to play, best first, as planned for this browser. */
      modes: listOf(isPlaybackMode),
      attempts: listOf(isPlaybackAttempt),
      /** Try playing anyway was pressed. */
      isForced: isBoolean,
      /** The connection proved too slow for this way, carrying `delivered` bits per second. */
      steppedDown: nullable(
        object({ from: isPlaybackMode, delivered: isNumber, needed: nullable(isNumber) }),
      ),
      /** The server's playback settings, or null when they could not be read. */
      settings: nullable(isPlaybackSettings),
    }),
  ),
  /** Seconds: where it was to start, and where the last failure caught it. */
  position: object({ resumeAt: isNumber, failedAt: nullable(isNumber) }),
  support: object({
    /** The browser's own answers for the file as it sits on disk. */
    play: listOf(isCodecSupport),
    /** Media Source Extensions' answers for the converted streams. */
    stream: listOf(isCodecSupport),
    hasMediaSource: isBoolean,
    hasManagedMediaSource: isBoolean,
  }),
  /** The media origin picked, without a ticket; null plays through the web host. */
  origin: nullable(object({ kind: isMediaOriginKind, url: isString, pickedAt: isString })),
  isProbingOrigins: isBoolean,
  device: isDeviceFacts,
  app: object({ version: nullable(isString), page: isString }),
  reportedAt: isString,
})

export type PlaybackDiagnostics = Infer<typeof isPlaybackDiagnostics>

/**
 * A report as the admin's Bug reports page lists it. `diagnostics` is kept
 * as it was sent, loosely read, so a report from an older player still lists.
 */
export const isBugReport = object({
  id: isNumber,
  status: isBugReportStatus,
  createdAt: isString,
  /** The account that sent it, `local` on a server without accounts, and its email when known. */
  reporter: object({ accountId: isString, email: nullable(isString) }),
  title: isString,
  /** The first problem the player listed. */
  summary: isString,
  mediaId: nullable(isNumber),
  diagnostics: isRecord,
})

export type BugReport = Infer<typeof isBugReport>

export const isBugReportList = listOf(isBugReport)

/** `PUT /api/reports/:id/status`. */
export const isBugReportStatusChange = object({ status: isBugReportStatus })

export type BugReportStatusChange = Infer<typeof isBugReportStatusChange>
