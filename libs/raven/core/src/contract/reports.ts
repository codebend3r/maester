import { isMediaItem } from '@/contract/items'
import { isPlaybackSettings } from '@/contract/settings'
import { isMediaOriginKind, isPlaybackMode } from '@/contract/streaming'
import { isAudioTrack, isSubtitleTrack } from '@/contract/tracks'
import {
  type Infer,
  isBoolean,
  isNumber,
  isRecord,
  isString,
  isStringArray,
  listOf,
  nullable,
  object,
  oneOf,
} from '@/schema'

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
