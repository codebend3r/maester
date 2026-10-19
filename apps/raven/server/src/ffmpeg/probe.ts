import { isNumber, isRecord, isString } from '@raven/core'

/** What the index keeps from an ffprobe run: enough to pick a playback mode and label a card. */
export type ProbeResult = {
  duration: number | null
  width: number | null
  height: number | null
  videoCodec: string | null
  videoBitDepth: number | null
  hdr: boolean
  audioCodec: string | null
  audioChannels: number | null
  bitrate: number | null
}

type Stream = Record<string, unknown>

/** ffprobe's `codec_type` for each kind of stream. */
export const CODEC_TYPES = { video: 'video', audio: 'audio', subtitle: 'subtitle' } as const

export type CodecType = (typeof CODEC_TYPES)[keyof typeof CODEC_TYPES]

/** ffprobe's `color_transfer` for the two HDR transfers: PQ, which HDR10 uses, and HLG. */
export const COLOR_TRANSFERS = { pq: 'smpte2084', hlg: 'arib-std-b67' } as const

/** ffprobe reports most numbers as strings ("5812.768000"); both shapes are accepted. */
export const numeric = (value: unknown): number | null => {
  const parsed = isString(value) ? Number(value) : value
  return isNumber(parsed) && parsed > 0 ? parsed : null
}

const disposition = ({ stream, flag }: { stream: Stream; flag: string }): boolean =>
  isRecord(stream.disposition) && stream.disposition[flag] === 1

/** 10 from "yuv420p10le", 12 from "yuv444p12be", 8 from "yuv420p". */
const bitDepthOf = (stream: Stream): number | null => {
  const pixelFormat = isString(stream.pix_fmt) ? stream.pix_fmt : ''
  const match = /p(\d{2})(?:le|be)$/.exec(pixelFormat)
  if (match?.[1]) return Number(match[1])
  const raw = numeric(stream.bits_per_raw_sample)
  if (raw != null) return raw
  return pixelFormat === '' ? null : 8
}

const HDR_TRANSFERS: ReadonlySet<string> = new Set(Object.values(COLOR_TRANSFERS))

/** Whether the stream carries a Dolby Vision configuration record. */
export const hasDolbyVision = (stream: Stream): boolean => {
  const sideData = Array.isArray(stream.side_data_list) ? stream.side_data_list : []
  return sideData.some(
    (entry) =>
      isRecord(entry) && isString(entry.side_data_type) && entry.side_data_type.includes('DOVI'),
  )
}

/** PQ or HLG transfer, or a Dolby Vision record (profile 5 carries no HDR10 transfer at all). */
const isHdr = (stream: Stream): boolean => {
  const transfer = isString(stream.color_transfer) ? stream.color_transfer : ''
  return HDR_TRANSFERS.has(transfer) || hasDolbyVision(stream)
}

/** ffprobe's names for the containers the HLS route treats apart, among the `format_name` it lists. */
const FORMAT_NAMES = { matroska: 'matroska', mpegts: 'mpegts' } as const

const formatOf = (output: unknown): Record<string, unknown> =>
  isRecord(output) && isRecord(output.format) ? output.format : {}

const formatNamesOf = (output: unknown): string[] => {
  const name = formatOf(output).format_name
  return isString(name) ? name.split(',') : []
}

/** Whether the file is an MPEG transport stream, which has no seek index. */
export const isTransportStream = (output: unknown): boolean =>
  formatNamesOf(output).includes(FORMAT_NAMES.mpegts)

/** A number of seconds as ffprobe writes one, which may be negative: "2.500000", "-0.023000". */
const secondsOf = (value: unknown): number | null => {
  const seconds = isString(value) ? Number(value) : value
  return isNumber(seconds) ? seconds : null
}

/** "24000/1001" from ffprobe, as 23.976; null for "0/0" and other nonsense. */
export const rateOf = (value: unknown): number | null => {
  if (!isString(value)) return null
  const [top = NaN, bottom = 1] = value.split('/').map(Number)
  const rate = top / bottom
  return isNumber(rate) && rate > 0 && rate < 1000 ? rate : null
}

const videoStreamOf = (streams: readonly Stream[]): Stream | undefined =>
  streams.find(
    (stream) =>
      stream.codec_type === CODEC_TYPES.video && !disposition({ stream, flag: 'attached_pic' }),
  )

/** Where a file's media lies on its own clock, which the HLS plans are cut on. */
export type MediaClock = {
  /**
   * Where the file's clock begins, `format.start_time`, or 0 when it names
   * none. A broadcast recording starts well past 0, and an AAC track's
   * priming can put it a few milliseconds before. Subtitles, extracted from
   * zero, are shifted by it.
   */
  start: number
  /** Where the media ends, or null when ffprobe knows no duration. */
  end: number | null
  /** The video's first timestamp, where a transcode's first segment starts. */
  videoStart: number
  /** The video's frames per second, the grid a transcode's boundaries fall on; null when unknown. */
  frameRate: number | null
}

/**
 * Reads the clock from `ffprobe -show_format -show_streams -of json`
 * output. Matroska measures its duration from 0 on its own timeline, so
 * there the duration is the end; elsewhere it runs from the start.
 */
export const mediaClockOf = (output: unknown): MediaClock => {
  const streams = (isRecord(output) && Array.isArray(output.streams) ? output.streams : []).filter(
    isRecord,
  )
  const format = formatOf(output)
  const start = secondsOf(format.start_time) ?? 0
  const duration = numeric(format.duration)
  const isMatroska = formatNamesOf(output).includes(FORMAT_NAMES.matroska)
  const end = duration == null ? null : isMatroska ? Math.max(duration, start) : start + duration
  const video = videoStreamOf(streams)
  return {
    start,
    end,
    videoStart: secondsOf(video?.start_time) ?? start,
    frameRate: rateOf(video?.r_frame_rate) ?? rateOf(video?.avg_frame_rate),
  }
}

/**
 * Reads `ffprobe -show_format -show_streams -of json` output. The video is
 * the first stream that is not cover art; the audio is the track flagged
 * default, else the first one.
 */
export const parseProbe = (output: unknown): ProbeResult | null => {
  if (!isRecord(output)) return null
  const streams = (Array.isArray(output.streams) ? output.streams : []).filter(isRecord)
  const format = isRecord(output.format) ? output.format : {}

  const video = videoStreamOf(streams)
  const audioTracks = streams.filter((stream) => stream.codec_type === CODEC_TYPES.audio)
  const audio =
    audioTracks.find((stream) => disposition({ stream, flag: 'default' })) ?? audioTracks[0]

  if (!video && !audio) return null

  return {
    duration: numeric(format.duration) ?? numeric(video?.duration),
    width: numeric(video?.width),
    height: numeric(video?.height),
    videoCodec: video && isString(video.codec_name) ? video.codec_name : null,
    videoBitDepth: video ? bitDepthOf(video) : null,
    hdr: video ? isHdr(video) : false,
    audioCodec: audio && isString(audio.codec_name) ? audio.codec_name : null,
    audioChannels: numeric(audio?.channels),
    bitrate: numeric(format.bit_rate),
  }
}
