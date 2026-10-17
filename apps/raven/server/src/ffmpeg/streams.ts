import {
  type AudioStream,
  type MediaStreams,
  type VideoRange,
  type VideoStream,
  isRecord,
  isString,
} from '@raven/core'
import { hasDolbyVision, numeric } from '@/ffmpeg/probe'

type Stream = Record<string, unknown>

const text = (value: unknown): string | null =>
  isString(value) && value.trim() !== '' ? value.trim() : null

/** ffprobe says 'unknown' for a codec it has no profile names for. */
const profileOf = (stream: Stream): string | null => {
  const profile = text(stream.profile)
  return profile == null || profile.toLowerCase() === 'unknown' ? null : profile
}

/**
 * MP4 keeps each stream's bitrate in the stream; Matroska has none of its
 * own, and mkvmerge writes it as a `BPS` tag (`BPS-eng` in older versions).
 */
const bitrateOf = (stream: Stream): number | null => {
  const tags = isRecord(stream.tags) ? stream.tags : {}
  const tagged = Object.entries(tags).find(([name]) => name === 'BPS' || name.startsWith('BPS-'))
  return numeric(stream.bit_rate) ?? numeric(tagged?.[1])
}

/** Dolby Vision wins over the HDR10 or HLG base layer it may sit on. */
const rangeOf = (stream: Stream): VideoRange => {
  if (hasDolbyVision(stream)) return 'dolbyVision'
  if (stream.color_transfer === 'smpte2084') return 'hdr10'
  if (stream.color_transfer === 'arib-std-b67') return 'hlg'
  return 'sdr'
}

const isCoverArt = (stream: Stream): boolean =>
  isRecord(stream.disposition) && stream.disposition.attached_pic === 1

/**
 * Reads the picture and every audio track in detail from `ffprobe
 * -show_streams -of json` output. The video is the first stream that is not
 * cover art, as the index's is; the audio tracks are numbered as
 * `parseTracks` numbers them.
 */
export const parseStreams = (output: unknown): MediaStreams => {
  const streams = (isRecord(output) && Array.isArray(output.streams) ? output.streams : []).filter(
    isRecord,
  )
  const picture = streams.find((stream) => stream.codec_type === 'video' && !isCoverArt(stream))
  const video: VideoStream | null = picture
    ? {
        codec: text(picture.codec_name),
        profile: profileOf(picture),
        bitrate: bitrateOf(picture),
        range: rangeOf(picture),
      }
    : null
  const audio = streams
    .filter((stream) => stream.codec_type === 'audio')
    .map((stream, index): AudioStream => ({
      index,
      codec: text(stream.codec_name),
      profile: profileOf(stream),
      channels: numeric(stream.channels),
      bitrate: bitrateOf(stream),
      sampleRate: numeric(stream.sample_rate),
    }))
  return { video, audio }
}
