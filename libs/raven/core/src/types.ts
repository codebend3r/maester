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
}

export type LibraryView = 'grid' | 'list' | 'tiles' | 'grouped'

export type MediaGroupBy = 'resolution' | 'codec' | 'month'

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
