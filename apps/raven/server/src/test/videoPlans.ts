import { MAX_HEIGHTS, PLAYBACK_MODES, QUALITIES, type StreamMode, VIDEO_CODECS } from '@raven/core'
import {
  type CopyPlan,
  type PicturePlan,
  type TranscodePlan,
  VIDEO_PLAN_KINDS,
} from '@/ffmpeg/args'
import { SOFTWARE } from '@/ffmpeg/encoder'

type CopyOfProps = Partial<Omit<CopyPlan, 'kind'>>

/** A remux's copy of an H.264 picture, with what a test sets apart. */
export const copyOf = (over: CopyOfProps = {}): CopyPlan => ({
  kind: VIDEO_PLAN_KINDS.copy,
  videoCodec: VIDEO_CODECS.h264,
  dolbyVision: null,
  ...over,
})

type TranscodeOfProps = Partial<Omit<TranscodePlan, 'kind'>>

/** A software transcode of an H.264 picture at the default settings, with what a test sets apart. */
export const transcodeOf = (over: TranscodeOfProps = {}): TranscodePlan => ({
  kind: VIDEO_PLAN_KINDS.transcode,
  encoder: SOFTWARE,
  videoCodec: VIDEO_CODECS.h264,
  tonemap: false,
  maxHeight: MAX_HEIGHTS.fullHd,
  quality: QUALITIES.medium,
  bitrate: null,
  burn: null,
  ...over,
})

/** The plain picture plan of `mode`. */
export const pictureFor = (mode: StreamMode): PicturePlan =>
  mode === PLAYBACK_MODES.remux ? copyOf() : transcodeOf()
