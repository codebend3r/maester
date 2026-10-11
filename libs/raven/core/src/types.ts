/**
 * The API contract between the media server and every client. Anything a
 * client renders, or the server returns, is one of these shapes, so the web
 * app and a future native app agree on the wire format by construction.
 */

export type ScanState = 'idle' | 'scanning'

export type ScanStatus = {
  state: ScanState
  /** Video files the walk found under the library's paths. */
  discovered: number
  /** Files already indexed: unchanged ones count straight away, new and changed ones once probed. */
  processed: number
  startedAt: string | null
  finishedAt: string | null
  /** The last scan's failure, cleared when the next scan starts. */
  error: string | null
}

export type Library = {
  id: number
  name: string
  /** Absolute folder paths as the server sees them (container paths under Docker). */
  paths: string[]
  itemCount: number
  /** Files no movie or show was found for; 0 in a library that is not matched. */
  unmatchedCount: number
  createdAt: string
  scan: ScanStatus
  settings: LibrarySettings
}

/** How a library behaves, each one set per library. */
export type LibrarySettings = {
  /** Remember where each video stopped and resume there. Off keeps saved spots without using them. */
  saveProgress: boolean
  /** Give the library its own link in the side menu. */
  pinned: boolean
  /** The order its videos are listed in. */
  sort: MediaSort
  /** How its videos are laid out: cards, a table, tiles, or cards in groups. */
  view: LibraryView
  /** What the grouped view buckets videos by. */
  groupBy: MediaGroupBy
  /** How far into a video, as a whole percentage, a play must get for it to count as watched. */
  watchedPercent: number
  /** What the library holds: movies, TV shows, or anything else. */
  kind: LibraryKind
  /** Whose score its cards show and its rating sorts use; TMDB's stands in where that source has none. */
  ratingsSource: ShownRatings
}

/** The scores a library can show on its cards: Metacritic has no card of its own. */
export type ShownRatings = 'tmdb' | 'imdb' | 'rottenTomatoes' | 'metacritic'

export type LibraryKind = 'movies' | 'shows' | 'other'

export type LibraryView = 'grid' | 'list' | 'tiles' | 'grouped'

/** `match` buckets a Movies or TV shows library by how far matching got. */
export type MediaGroupBy = 'match' | 'resolution' | 'codec' | 'month'

/**
 * What a client sends to create a library or replace its name and paths.
 * Settings left out keep their defaults on create and their current values
 * on update, so a client can change one without knowing the rest.
 */
export type LibraryInput = {
  name: string
  paths: string[]
  settings?: Partial<LibrarySettings>
}

export type ThumbnailState = 'pending' | 'ready' | 'failed'

export type MediaItem = {
  id: number
  libraryId: number
  title: string
  fileName: string
  /** The folder the file sits in, relative to the library path that found it; '' at the root. */
  folder: string
  size: number
  /** Normalised from the file extension: 'mp4', 'mkv', 'webm', 'mov', ... */
  container: string
  /** Seconds, or null until the file has been probed. */
  duration: number | null
  width: number | null
  height: number | null
  /** ffprobe codec names: 'h264', 'hevc', 'vp9', 'av1', ... */
  videoCodec: string | null
  videoBitDepth: number | null
  hdr: boolean
  /** ffprobe codec names: 'aac', 'ac3', 'eac3', 'opus', 'truehd', ... */
  audioCodec: string | null
  audioChannels: number | null
  /** Bits per second across the whole file. */
  bitrate: number | null
  thumbnail: ThumbnailState
  /** Changes whenever the file does, so a thumbnail URL can be cached forever. */
  thumbnailVersion: number
  /** Where playback last stopped, in seconds; 0 when never started or finished. */
  position: number
  favourite: boolean
  addedAt: string
  /** How far matching got: see `MatchState`. */
  match: MatchState
  /** The year the name gives, in a Movies or TV shows library; null elsewhere. */
  year: number | null
  /** Plex's `{edition-...}` from the name. */
  edition: string | null
  /** The movie or episode this file is, once matched. */
  item: ItemSummary | null
  /** How many files in its library are the same movie, this one included; 1 for anything else. */
  versions: number
}

/**
 * `pending` waits for matching, `matched` found its item by itself,
 * `manual` was chosen with Fix match, `unmatched` found nothing sure, and
 * `off` is a library that is not Movies or TV shows, or an extra.
 */
export type MatchState = 'pending' | 'matched' | 'manual' | 'unmatched' | 'off'

export type ItemType = 'movie' | 'show' | 'season' | 'episode'

/** What a card needs to show a movie, show, season or episode. */
export type ItemSummary = {
  id: number
  type: ItemType
  title: string
  year: number | null
  /** For seasons and episodes: the show they belong to. */
  show: { id: number; title: string } | null
  season: number | null
  episode: number | null
  /** Changes whenever the poster does; null when there is none. */
  posterVersion: string | null
  /** Every score it has, one per source. */
  ratings: Rating[]
}

export type RatingSource = 'tmdb' | 'imdb' | 'rottenTomatoes' | 'metacritic'

export type Rating = {
  source: RatingSource
  /** Rotten Tomatoes and Metacritic are critics; TMDB and IMDb are audiences. */
  kind: 'critic' | 'audience'
  /** Out of 10. */
  value: number
  votes: number | null
}

export type CreditJob = 'cast' | 'guest' | 'director' | 'writer' | 'creator' | 'producer'

export type Credit = {
  personId: number
  name: string
  job: CreditJob
  /** The character, or the job in full: "Screenplay", "Novel". */
  role: string | null
  photoVersion: string | null
}

/** Everything a movie, show, season or episode page shows. */
export type ItemDetails = ItemSummary & {
  tmdbId: string
  imdbId: string | null
  originalTitle: string | null
  tagline: string | null
  summary: string | null
  contentRating: string | null
  released: string | null
  ended: string | null
  /** Minutes, from TMDB; pages prefer the file's own length. */
  runtime: number | null
  studio: string | null
  genres: string[]
  /** The backdrop's version; for an episode, its still's. */
  backdropVersion: string | null
  credits: Credit[]
  /** Reviews by TMDB members, newest first; at most ten. */
  reviews: Review[]
  /** Every file that is this item, in any library, best first. */
  versions: MediaItem[]
  /** A show's seasons, or a season's episodes, in order. */
  children: ItemSummary[]
}

/** A show in a TV shows library's listing. */
export type ShowEntry = {
  show: ItemSummary
  /** Distinct episodes on disk. */
  episodes: number
  /** The year the show ended, or null while it still airs. */
  endedYear: number | null
  /** When its newest file arrived. */
  addedAt: string
  /** The first episode not yet watched by the library's measure, or null when every one is. */
  next: MediaItem | null
}

/** A TV shows library: its shows, and the files no show was found for. */
export type ShowListing = {
  shows: ShowEntry[]
  unmatched: MediaItem[]
}

/** A review by a TMDB member, as TMDB hands it on. */
export type Review = {
  id: number
  author: string
  /** Changes with the avatar; null when TMDB hosts none. */
  avatarVersion: string | null
  /** Out of 10, when the author gave one. */
  rating: number | null
  /** Plain text; never rendered as HTML. */
  content: string
  /** The review on TMDB. */
  url: string
  writtenAt: string
}

/** A person's page: who they are, and everything in raven they are credited on. */
export type PersonDetails = {
  id: number
  name: string
  photoVersion: string | null
  /** Movies and shows on disk, newest first. */
  credits: Array<{ item: ItemSummary; job: CreditJob; role: string | null }>
}

/** The pictures an item can have. */
export type ItemImageKind = 'poster' | 'backdrop' | 'still'

/** One picture a movie or show could show: a file beside the media, or one of TMDB's. */
export type ImageOption = {
  source: 'local' | 'tmdb'
  /** The file's path for `local`; TMDB's path for `tmdb`, served through `imageOptionUrl`. */
  ref: string
  width: number | null
  height: number | null
  /** ISO 639-1, or null for a picture with no text. */
  language: string | null
  /** Whether the item shows this one now. */
  current: boolean
}

/** Everything a movie or show could show as its poster and backdrop. */
export type ItemImageOptions = {
  poster: ImageOption[]
  backdrop: ImageOption[]
}

/**
 * How the server plays video, set once for every viewer in Settings.
 *
 * - `directPlay`: `auto` plays the original file when the browser takes it
 *   and converts otherwise; `force` always sends the original file, for a
 *   browser the check underrates.
 * - `transcoding`: `on` remuxes and transcodes as needed; `remuxOnly` never
 *   re-encodes video; `off` converts nothing, so only files the browser
 *   plays as they are play.
 * - `maxHeight`: the frame a transcode is scaled down to.
 * - `quality`: how hard a transcode is squeezed: `low` for a slow network,
 *   `high` for a big screen.
 * - `hwAccel`: what encodes a transcode: `auto` takes the GPU the machine
 *   has, `none` keeps to the CPU.
 * - `tonemap`: whether HDR is tone mapped to SDR on a transcode when the
 *   build can.
 */
export type PlaybackSettings = {
  directPlay: 'auto' | 'force'
  transcoding: 'on' | 'remuxOnly' | 'off'
  maxHeight: 2160 | 1080 | 720
  quality: 'low' | 'medium' | 'high'
  hwAccel: 'auto' | 'none' | 'vaapi' | 'videotoolbox'
  tonemap: boolean
}

/** The settings as kept, with what they come to on this machine. */
export type PlaybackSettingsState = {
  settings: PlaybackSettings
  effective: {
    /** What transcodes encode with, after the test encode. */
    encoder: 'software' | 'vaapi' | 'videotoolbox'
    /** Whether this ffmpeg can tone map at all. */
    tonemapAvailable: boolean
  }
}

/** The fields Edit metadata can write over: what a page shows for a movie or show. */
export type ItemMetadata = {
  title: string
  year: number | null
  tagline: string | null
  summary: string | null
  contentRating: string | null
}

/** Edit metadata: what the page shows, what TMDB says, and which fields were written over. */
export type ItemMetadataState = {
  shown: ItemMetadata
  original: ItemMetadata
  overridden: (keyof ItemMetadata)[]
}

/** What Edit metadata sends: each field given is written over, or cleared back to TMDB's with null. */
export type ItemMetadataChange = {
  title?: string | null
  year?: number | null
  tagline?: string | null
  summary?: string | null
  contentRating?: string | null
}

/** What Edit images picks: one of TMDB's pictures, or the one beside the media. */
export type ImageChoice = { source: 'tmdb'; ref: string } | { source: 'local' }

/** One of TMDB's search results, offered by Fix match. */
export type MatchCandidate = {
  tmdbId: string
  title: string
  year: number | null
  overview: string | null
  /** TMDB's path for the poster, served through `candidatePosterUrl`. */
  poster: string | null
}

/** `off` when not configured, `failing` when the last call went wrong. */
export type MetadataServiceState = 'off' | 'ok' | 'failing'

/** How metadata is doing, from `/api/health`. */
export type MetadataHealth = {
  tmdb: MetadataServiceState
  omdb: MetadataServiceState
  /** Files waiting to be matched. */
  pending: number
  /** Why TMDB is failing, never the token itself. */
  error: string | null
  /** When TMDB last answered. */
  lastOk: string | null
}

/** A video in a library's history: when it last played, how often, and how far it got. */
export type HistoryEntry = {
  media: MediaItem
  lastPlayedAt: string
  plays: number
  /** The furthest any play got, in seconds. */
  furthest: number
  /** Whether a play got past the library's watched percentage. */
  watched: boolean
}

/**
 * `added` is newest first and `oldest` the reverse. Resolution ranks by
 * pixel count. `random` shuffles by a seed the client sends, so the order
 * holds across refetches until the client deals a new one.
 */
export type MediaSort =
  | 'title'
  | 'added'
  | 'oldest'
  | 'largest'
  | 'smallest'
  | 'bitrate-high'
  | 'bitrate-low'
  | 'resolution-high'
  | 'resolution-low'
  | 'year-new'
  | 'year-old'
  | 'rating-high'
  | 'rating-low'
  | 'random'

export type DirectoryEntry = {
  name: string
  path: string
}

export type DirectoryListing = {
  path: string
  /** null at the browse root, where the server will not go any higher. */
  parent: string | null
  directories: DirectoryEntry[]
}

export type ApiErrorBody = {
  statusCode: number
  message: string | string[]
}

export type AudioTrack = {
  /** Position among the file's audio tracks, as ffmpeg's `0:a:N` counts them. */
  index: number
  /** ffprobe codec name: 'aac', 'eac3', 'truehd', ... */
  codec: string | null
  channels: number | null
  /** Normalised by `languageTag`: 'en' for 'eng', 'English' or 'en-US'; null when untagged. */
  language: string | null
  title: string | null
  default: boolean
}

/** Embedded in the video file, or a file of its own beside it. */
export type SubtitleSource = 'embedded' | 'external'

export type SubtitleTrack = {
  /** Stable for the file: `embedded-N` for the Nth subtitle stream, `external-N` for the Nth sidecar. */
  id: string
  source: SubtitleSource
  /** ffprobe codec name ('subrip', 'ass', 'hdmv_pgs_subtitle', ...), or the sidecar's extension. */
  codec: string | null
  /** Normalised by `languageTag`, like an audio track's. */
  language: string | null
  title: string | null
  default: boolean
  forced: boolean
  hearingImpaired: boolean
  /** Text tracks convert to WebVTT; image tracks (PGS, VobSub, DVB) cannot be shown. */
  supported: boolean
}

/** What a player can choose between, read from the file when it is opened. */
export type MediaTracks = {
  audio: AudioTrack[]
  subtitles: SubtitleTrack[]
  /** The audio track direct play gets: the one flagged default, else the first. */
  defaultAudio: number | null
  /** Frames per second, for stepping a frame at a time. */
  frameRate: number | null
}

/** One subtitle, timed against the file. `text` may hold `<i>`, `<b>` and `<u>`. */
export type SubtitleCue = {
  start: number
  end: number
  text: string
}

/**
 * How a file reaches the player: the original bytes, a remux with the video
 * copied and the audio converted, or a full conversion of both.
 */
export type PlaybackMode = 'direct' | 'remux' | 'transcode'

/** The two ways the server can convert a file on the fly. */
export type StreamMode = Exclude<PlaybackMode, 'direct'>
