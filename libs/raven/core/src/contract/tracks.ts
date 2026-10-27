import {
  type Infer,
  isBoolean,
  isNumber,
  isString,
  listOf,
  nullable,
  object,
  oneOf,
} from '@/schema'

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
