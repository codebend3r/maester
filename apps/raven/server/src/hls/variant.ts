import {
  type AudioTrack,
  type DolbyVisionConfig,
  HLS_COPY_AUDIO_CODECS,
  PLAYBACK_MODES,
  type StreamMode,
  VIDEO_CODECS,
  audioCodecString,
  dolbyVisionCodecString,
  videoCodecString,
} from '@raven/core'
import { type TranscodeQuality, isDolbyVisionCopy, transcodeBitrate } from '@/ffmpeg/args'
import { hlsAudioCodec } from '@/ffmpeg/hlsArgs'
import { type SegmentPlan, playlistLength } from '@/hls/segmentPlan'

/** RFC 6381 names HLS players read differently from `MediaSource`, which `audioCodecString` serves. */
const HLS_AUDIO_STRINGS: Readonly<Record<string, string>> = { [HLS_COPY_AUDIO_CODECS.flac]: 'fLaC' }

type Frame = { width: number; height: number }

/** The frame a transcode comes out at: no taller than `maxHeight`, the width kept in proportion and even. */
const scaledTo = ({ width, height, maxHeight }: Frame & { maxHeight: number }): Frame => {
  const scaled = Math.min(height, maxHeight)
  return { width: Math.round((width * scaled) / height / 2) * 2, height: scaled }
}

type VideoStringOfProps = {
  mode: StreamMode
  videoCodec: string | null
  bitDepth: number | null
  /** The picture's Dolby Vision configuration, or null for a picture without one. */
  dolbyVision: DolbyVisionConfig | null
}

/**
 * A transcode's video is 8-bit H.264 High; a remux's is the file's own, or
 * null when HLS cannot name it. A remux of Dolby Vision HEVC is copied under
 * `dvh1`, so it is named as Dolby Vision, which the device then decodes itself.
 */
export const videoStringOf = ({
  mode,
  videoCodec,
  bitDepth,
  dolbyVision,
}: VideoStringOfProps): string | null => {
  if (mode === PLAYBACK_MODES.transcode) {
    return videoCodecString({ codec: VIDEO_CODECS.h264, bitDepth: null })
  }
  if (videoCodec == null) return null
  const copy = { videoCodec, dolbyVision }
  if (isDolbyVisionCopy(copy)) return dolbyVisionCodecString(copy.dolbyVision)
  return videoCodecString({ codec: videoCodec, bitDepth })
}

const audioStringOf = (track: AudioTrack): string | null => {
  const codec = hlsAudioCodec(track)
  return HLS_AUDIO_STRINGS[codec] ?? audioCodecString(codec)
}

type VariantOfProps = {
  mode: StreamMode
  videoString: string
  audio: AudioTrack | null
  frame: Frame
  plan: SegmentPlan
  fileBitrate: number | null
  bytes: number
  maxHeight: number
  quality: TranscodeQuality
  bitrate: number | null
}

/** The variant's `CODECS`, `RESOLUTION` and `BANDWIDTH`. */
type VariantFacts = { codecs: string; resolution: Frame; bandwidth: number }

/**
 * The master playlist's `CODECS`, `RESOLUTION` and `BANDWIDTH` for the one
 * variant: a remux keeps the file's frame and bitrate, or its size over the
 * playlist's length when ffprobe names no bitrate; a transcode is scaled
 * under `maxHeight` and aims for the bitrate it encodes at.
 */
export const variantOf = ({
  mode,
  videoString,
  audio,
  frame,
  plan,
  fileBitrate,
  bytes,
  maxHeight,
  quality,
  bitrate,
}: VariantOfProps): VariantFacts => {
  const audioString = audio ? audioStringOf(audio) : null
  const codecs = [videoString, ...(audioString == null ? [] : [audioString])].join(',')
  if (mode === PLAYBACK_MODES.remux) {
    return {
      codecs,
      resolution: frame,
      bandwidth: fileBitrate ?? Math.round((bytes * 8) / playlistLength(plan)),
    }
  }
  return {
    codecs,
    resolution: scaledTo({ ...frame, maxHeight }),
    bandwidth: transcodeBitrate({ quality, bitrate }),
  }
}
