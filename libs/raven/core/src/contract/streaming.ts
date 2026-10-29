import { isMediaItem } from '@/contract/items'
import {
  type Infer,
  isNumber,
  isString,
  listOf,
  matching,
  nullable,
  object,
  oneOf,
  union,
} from '@/schema'

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

/** Why a client asks for a file: to play it, or to keep a copy of it, as Raven's downloads do. */
export const STREAM_PURPOSES = { play: 'play', download: 'download' } as const

export const isStreamPurpose = oneOf(Object.values(STREAM_PURPOSES))

export type StreamPurpose = Infer<typeof isStreamPurpose>

/** The query key a file request names its purpose in; a request without one plays. */
export const MEDIA_PURPOSE_PARAM = 'purpose'

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

/** The placeholder names in `HLS_PATHS` and the master playlist's query keys. */
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

/** ffprobe's names for the audio codecs an HLS stream copies; any other becomes E-AC-3. */
export const HLS_COPY_AUDIO_CODECS = {
  aac: 'aac',
  ac3: 'ac3',
  eac3: 'eac3',
  alac: 'alac',
  flac: 'flac',
} as const

export const HLS_COPY_AUDIO = Object.values(HLS_COPY_AUDIO_CODECS)

/** A session id is 16 random bytes in base64url without padding. */
export const isHlsSessionId = matching(/^[A-Za-z0-9_-]{22}$/)

/**
 * What every live stream says, watched or downloaded. `browser` and `device`
 * are read from the User-Agent header, so they are the client's own word for
 * itself; `address` is where the requests came from, which behind a proxy is
 * the address the proxy forwards. `position` is the last spot the player
 * reported, in seconds, and null until it reports one.
 */
const LIVE_STREAM_FIELDS = {
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
}

/**
 * A video the server is sending to one browser or device right now, as the
 * admin's Streams page lists it: a play, or a download, which also says how
 * far into the file it has been sent, in bytes, counting the part it already
 * had when it resumed.
 */
export const isLiveStream = union(
  object({ ...LIVE_STREAM_FIELDS, purpose: oneOf([STREAM_PURPOSES.play]) }),
  object({
    ...LIVE_STREAM_FIELDS,
    purpose: oneOf([STREAM_PURPOSES.download]),
    received: isNumber,
  }),
)

export type LiveStream = Infer<typeof isLiveStream>

/** A live stream that is a download. */
export type LiveDownload = Extract<LiveStream, { purpose: typeof STREAM_PURPOSES.download }>

export const isLiveStreamList = listOf(isLiveStream)

/** The player fetches a new ticket this long before the old one expires. */
export const MEDIA_TICKET_REFRESH_SECONDS = 600

/** How many bytes of a file an origin probe reads. */
export const MEDIA_PROBE_BYTES = 262_144
