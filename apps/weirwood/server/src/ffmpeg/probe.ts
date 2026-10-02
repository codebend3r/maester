import { isNumber, isRecord, isString } from '@weirwood/core'

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

/** ffprobe reports most numbers as strings ("5812.768000"); both shapes are accepted. */
const numeric = (value: unknown): number | null => {
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

const HDR_TRANSFERS: ReadonlySet<string> = new Set(['smpte2084', 'arib-std-b67'])

/** PQ or HLG transfer, or a Dolby Vision record (profile 5 carries no HDR10 transfer at all). */
const isHdr = (stream: Stream): boolean => {
  const transfer = isString(stream.color_transfer) ? stream.color_transfer : ''
  const sideData = Array.isArray(stream.side_data_list) ? stream.side_data_list : []
  const dolbyVision = sideData.some(
    (entry) =>
      isRecord(entry) && isString(entry.side_data_type) && entry.side_data_type.includes('DOVI'),
  )
  return HDR_TRANSFERS.has(transfer) || dolbyVision
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

  const video = streams.find(
    (stream) => stream.codec_type === 'video' && !disposition({ stream, flag: 'attached_pic' }),
  )
  const audioTracks = streams.filter((stream) => stream.codec_type === 'audio')
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
