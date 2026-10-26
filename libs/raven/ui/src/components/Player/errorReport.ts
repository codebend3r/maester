import {
  type CanPlay,
  type CodecSupport,
  type DeviceFacts,
  type MediaItem,
  type MediaTracks,
  PLAYBACK_MODES,
  type PlaybackDiagnostics,
  type SubtitleTrack,
  audioCodecString,
  containerMimeType,
  isBoolean,
  isNumber,
  isRecord,
  isString,
  listOf,
  object,
  streamMimeType,
  videoCodecString,
  withoutTickets,
} from '@raven/core'
import type { LadderFacts } from '@/components/Player/usePlaybackLadder'
import { browserCanPlay, browserCanStream } from '@/lib/canPlay'
import type { MediaPick } from '@/stores/mediaOrigin'

/** What the player knew beyond the problems on screen; null where it knew nothing. */
export type ReportContext = {
  media: MediaItem | null
  tracks: MediaTracks | null
  /** The audio track picked; null for the file's default. */
  audio: number | null
  subtitle: SubtitleTrack | null
  ladder: LadderFacts | null
}

/** A player with no library file or ladder: a local file's, or the native engine's. */
export const NO_CONTEXT: ReportContext = {
  media: null,
  tracks: null,
  audio: null,
  subtitle: null,
  ladder: null,
}

/** What the toast says once a report is in. */
export const REPORTED_MESSAGE = 'Error reported. The admin has been sent the details.'

/** What Unplayable says when the report could not be sent. */
export const REPORT_FAILED_MESSAGE = 'The report could not be sent. Try again.'

const isBrand = object({ brand: isString, version: isString })

/** `navigator.userAgentData`, where Chromium has it. */
const isUserAgentData = object({
  brands: listOf(isBrand),
  mobile: isBoolean,
  platform: isString,
})

const textOrNull = (value: unknown): string | null => (isString(value) ? value : null)

const numberOrNull = (value: unknown): number | null => (isNumber(value) ? value : null)

/** `navigator.connection`, whose fields each browser fills as it likes. */
const connectionFacts = (connection: unknown): DeviceFacts['connection'] => {
  if (!isRecord(connection)) return null
  return {
    type: textOrNull(connection.type),
    effectiveType: textOrNull(connection.effectiveType),
    downlink: numberOrNull(connection.downlink),
    rtt: numberOrNull(connection.rtt),
    saveData: isBoolean(connection.saveData) ? connection.saveData : null,
  }
}

type SizeOrNullProps = { width: number; height: number }

const sizeOrNull = ({ width, height }: SizeOrNullProps) =>
  width > 0 && height > 0 ? { width, height } : null

/** The browser and machine, as far as they say; read at the press of the button. */
export const readDevice = (): DeviceFacts => {
  const agentData: unknown = 'userAgentData' in navigator ? navigator.userAgentData : null
  const agent = isUserAgentData(agentData) ? agentData : null
  const memory: unknown = 'deviceMemory' in navigator ? navigator.deviceMemory : null
  const connection: unknown = 'connection' in navigator ? navigator.connection : null
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone
  return {
    userAgent: navigator.userAgent,
    brands: agent?.brands.map(({ brand, version }) => `${brand} ${version}`) ?? null,
    isMobile: agent?.mobile ?? null,
    platform: agent?.platform ?? navigator.platform,
    language: navigator.language === '' ? null : navigator.language,
    languages: [...navigator.languages],
    screen: sizeOrNull({ width: window.screen.width, height: window.screen.height }),
    viewport: sizeOrNull({ width: window.innerWidth, height: window.innerHeight }),
    pixelRatio: numberOrNull(window.devicePixelRatio),
    cores: numberOrNull(navigator.hardwareConcurrency),
    memory: numberOrNull(memory),
    connection: connectionFacts(connection),
    isOnline: navigator.onLine,
    timeZone: timeZone === '' ? null : timeZone,
  }
}

type AskedProps = { type: string; canPlay: CanPlay }

const asked = ({ type, canPlay }: AskedProps): CodecSupport => ({
  type,
  isSupported: canPlay(type),
})

type CodecSupportProps = {
  media: MediaItem | null
  canPlay: CanPlay
  canStream: CanPlay
}

/**
 * The browser's answers for this file: its container, video and audio as
 * direct play asks about them, and the converted streams as Media Source
 * Extensions take them.
 */
export const codecSupport = ({
  media,
  canPlay,
  canStream,
}: CodecSupportProps): PlaybackDiagnostics['support'] => {
  const hasMediaSource = typeof window !== 'undefined' && 'MediaSource' in window
  const hasManagedMediaSource = typeof window !== 'undefined' && 'ManagedMediaSource' in window
  if (!media) return { play: [], stream: [], hasMediaSource, hasManagedMediaSource }
  const mime = containerMimeType(media.container)
  const video =
    media.videoCodec == null
      ? null
      : videoCodecString({ codec: media.videoCodec, bitDepth: media.videoBitDepth })
  const audio = media.audioCodec == null ? null : audioCodecString(media.audioCodec)
  const playTypes =
    mime == null
      ? []
      : [mime, ...[video, audio].flatMap((codec) => (codec ? [`${mime}; codecs="${codec}"`] : []))]
  return {
    play: playTypes.map((type) => asked({ type, canPlay })),
    stream: [PLAYBACK_MODES.remux, PLAYBACK_MODES.transcode].map((mode) =>
      asked({ type: streamMimeType({ media, mode }), canPlay: canStream }),
    ),
    hasMediaSource,
    hasManagedMediaSource,
  }
}

const mediaFacts = (media: MediaItem): NonNullable<PlaybackDiagnostics['media']> => ({
  id: media.id,
  libraryId: media.libraryId,
  fileName: media.fileName,
  container: media.container,
  size: media.size,
  duration: media.duration,
  width: media.width,
  height: media.height,
  videoCodec: media.videoCodec,
  videoBitDepth: media.videoBitDepth,
  hdr: media.hdr,
  audioCodec: media.audioCodec,
  audioChannels: media.audioChannels,
  bitrate: media.bitrate,
})

const trackFacts = ({
  tracks,
  audio,
  subtitle,
}: Pick<ReportContext, 'tracks' | 'audio' | 'subtitle'>): PlaybackDiagnostics['tracks'] => {
  const playing = audio ?? tracks?.defaultAudio ?? null
  return {
    audio: tracks?.audio.find((track) => track.index === playing) ?? null,
    subtitle,
    audioCount: tracks?.audio.length ?? null,
    subtitleCount: tracks?.subtitles.length ?? null,
  }
}

type GatherDiagnosticsProps = {
  title: string
  problems: string[]
  resumeAt: number
  context: ReportContext
  pick: MediaPick | null
  isProbingOrigins: boolean
  appVersion: string | null
  now?: Date
}

/**
 * Everything that might say why a video would not play, gathered in one go
 * when the viewer presses Report this error, with no ticket left in it.
 */
export const gatherDiagnostics = ({
  title,
  problems,
  resumeAt,
  context,
  pick,
  isProbingOrigins,
  appVersion,
  now = new Date(),
}: GatherDiagnosticsProps): PlaybackDiagnostics =>
  withoutTickets({
    title,
    problems,
    media: context.media && mediaFacts(context.media),
    tracks: trackFacts(context),
    playback: context.ladder,
    position: { resumeAt, failedAt: context.ladder?.attempts.at(-1)?.position ?? null },
    support: codecSupport({
      media: context.media,
      canPlay: browserCanPlay,
      canStream: browserCanStream,
    }),
    origin: pick && {
      kind: pick.origin.kind,
      url: pick.origin.url,
      pickedAt: new Date(pick.at).toISOString(),
    },
    isProbingOrigins,
    device: readDevice(),
    app: {
      version: appVersion,
      page: `${window.location.origin}${window.location.pathname}`,
    },
    reportedAt: now.toISOString(),
  })
