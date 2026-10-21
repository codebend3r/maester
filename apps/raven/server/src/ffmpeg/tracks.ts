import {
  type AudioTrack,
  type SubtitleTrack,
  isNumber,
  isRecord,
  isString,
  languageTag,
} from '@raven/core'
import { CODEC_TYPES, type CodecType, rateOf } from '@/ffmpeg/probe'

type Stream = Record<string, unknown>

/** The tracks inside a file. Sidecar subtitles are added by `TracksService`. */
export type FileTracks = {
  audio: AudioTrack[]
  /** Only the embedded ones, numbered as ffmpeg's `0:s:N` counts them. */
  subtitles: SubtitleTrack[]
  defaultAudio: number | null
  frameRate: number | null
}

/**
 * Subtitle codecs ffmpeg turns into WebVTT. Everything else (PGS, VobSub,
 * DVB, XSUB) is a picture of text and would need OCR or burning in.
 */
const TEXT_SUBTITLES: ReadonlySet<string> = new Set([
  'subrip',
  'srt',
  'ass',
  'ssa',
  'webvtt',
  'mov_text',
  'text',
  'subviewer',
  'subviewer1',
  'microdvd',
  'mpl2',
  'sami',
  'realtext',
  'jacosub',
  'pjs',
  'vplayer',
  'stl',
])

const isTextSubtitle = (codec: string | null): boolean => codec != null && TEXT_SUBTITLES.has(codec)

const flag = ({ stream, name }: { stream: Stream; name: string }): boolean =>
  isRecord(stream.disposition) && stream.disposition[name] === 1

const tag = ({ stream, name }: { stream: Stream; name: string }): string | null => {
  const value = isRecord(stream.tags) ? stream.tags[name] : null
  return isString(value) && value.trim() !== '' ? value.trim() : null
}

const codecOf = (stream: Stream): string | null =>
  isString(stream.codec_name) ? stream.codec_name : null

const frameRateOf = (stream: Stream | undefined): number | null =>
  rateOf(stream?.avg_frame_rate ?? null) ?? rateOf(stream?.r_frame_rate ?? null)

/**
 * Reads the audio and subtitle tracks from `ffprobe -show_streams -of json`
 * output. The default audio track follows the same rule as the index's
 * `audioCodec`: the one flagged default, else the first.
 */
export const parseTracks = (output: unknown): FileTracks => {
  const streams = (isRecord(output) && Array.isArray(output.streams) ? output.streams : []).filter(
    isRecord,
  )
  const ofType = (type: CodecType): Stream[] =>
    streams.filter((stream) => stream.codec_type === type)

  const audio = ofType(CODEC_TYPES.audio).map((stream, index): AudioTrack => ({
    index,
    codec: codecOf(stream),
    channels: isNumber(stream.channels) && stream.channels > 0 ? stream.channels : null,
    language: languageTag(tag({ stream, name: 'language' })),
    title: tag({ stream, name: 'title' }),
    default: flag({ stream, name: 'default' }),
  }))
  const subtitles = ofType(CODEC_TYPES.subtitle).map((stream, index): SubtitleTrack => ({
    id: `embedded-${index}`,
    source: 'embedded',
    codec: codecOf(stream),
    language: languageTag(tag({ stream, name: 'language' })),
    title: tag({ stream, name: 'title' }),
    default: flag({ stream, name: 'default' }),
    forced: flag({ stream, name: 'forced' }),
    hearingImpaired: flag({ stream, name: 'hearing_impaired' }),
    supported: isTextSubtitle(codecOf(stream)),
  }))
  const video = ofType(CODEC_TYPES.video).find((stream) => !flag({ stream, name: 'attached_pic' }))
  const defaultAudio = audio.find((track) => track.default)?.index ?? audio[0]?.index ?? null

  return { audio, subtitles, defaultAudio, frameRate: frameRateOf(video) }
}
