import {
  type Guard,
  type Infer,
  isBoolean,
  isNumber,
  isString,
  listOf,
  nullable,
  object,
  oneOf,
  union,
} from '@raven/core'

const optional =
  <T>(guard: Guard<T>) =>
  (value: unknown): value is T | undefined =>
    value === undefined || guard(value)

export const MPV_TRACK_TYPES = { audio: 'audio', sub: 'sub', video: 'video' } as const

/** The word mpv answers beside a flag or a number when it chooses for itself. */
export const MPV_CHOICES = { auto: 'auto' } as const

export const isMpvTrack = object({
  id: isNumber,
  type: oneOf(Object.values(MPV_TRACK_TYPES)),
  selected: optional(isBoolean),
  default: optional(isBoolean),
  external: optional(isBoolean),
  forced: optional(isBoolean),
  'hearing-impaired': optional(isBoolean),
  lang: optional(isString),
  title: optional(isString),
  codec: optional(isString),
  'demux-channel-count': optional(isNumber),
})
export type MpvTrack = Infer<typeof isMpvTrack>

export const MPV_PROPERTIES = {
  mpvVersion: 'mpv-version',
  optionsConfig: 'options/config',
  optionsLoadScripts: 'options/load-scripts',
  optionsYtdl: 'options/ytdl',
  optionsOsc: 'options/osc',
  optionsInputDefaultBindings: 'options/input-default-bindings',
  optionsInputVoKeyboard: 'options/input-vo-keyboard',
  optionsCache: 'options/cache',
  optionsDemuxerMaxBytes: 'options/demuxer-max-bytes',
  optionsDemuxerMaxBackBytes: 'options/demuxer-max-back-bytes',
  ffmpegVersion: 'ffmpeg-version',
  timePos: 'time-pos',
  duration: 'duration',
  pause: 'pause',
  pausedForCache: 'paused-for-cache',
  seeking: 'seeking',
  speed: 'speed',
  aid: 'aid',
  sid: 'sid',
  vid: 'vid',
  trackList: 'track-list',
  containerFps: 'container-fps',
  audioDeviceList: 'audio-device-list',
  demuxerCacheState: 'demuxer-cache-state',
  hwdecCurrent: 'hwdec-current',
  frameDropCount: 'frame-drop-count',
  decoderFrameDropCount: 'decoder-frame-drop-count',
  displayFpsOverride: 'display-fps-override',
  targetColorspaceHint: 'target-colorspace-hint',
} as const

export type MpvProperty = (typeof MPV_PROPERTIES)[keyof typeof MPV_PROPERTIES]

export const propertyGuards = {
  [MPV_PROPERTIES.mpvVersion]: isString,
  [MPV_PROPERTIES.optionsConfig]: isBoolean,
  [MPV_PROPERTIES.optionsLoadScripts]: isBoolean,
  [MPV_PROPERTIES.optionsYtdl]: isBoolean,
  [MPV_PROPERTIES.optionsOsc]: isBoolean,
  [MPV_PROPERTIES.optionsInputDefaultBindings]: isBoolean,
  [MPV_PROPERTIES.optionsInputVoKeyboard]: isBoolean,
  // mpv reports `cache=yes` as the flag `true` and `no` as `false`.
  [MPV_PROPERTIES.optionsCache]: union(isBoolean, oneOf([MPV_CHOICES.auto])),
  [MPV_PROPERTIES.optionsDemuxerMaxBytes]: isNumber,
  [MPV_PROPERTIES.optionsDemuxerMaxBackBytes]: isNumber,
  [MPV_PROPERTIES.ffmpegVersion]: isString,
  [MPV_PROPERTIES.timePos]: nullable(isNumber),
  [MPV_PROPERTIES.duration]: nullable(isNumber),
  [MPV_PROPERTIES.pause]: isBoolean,
  // Unavailable (null) while mpv is idle, which is before and after every file.
  [MPV_PROPERTIES.pausedForCache]: nullable(isBoolean),
  [MPV_PROPERTIES.seeking]: nullable(isBoolean),
  [MPV_PROPERTIES.speed]: isNumber,
  [MPV_PROPERTIES.aid]: nullable(union(isNumber, oneOf([false, MPV_CHOICES.auto]))),
  [MPV_PROPERTIES.sid]: nullable(union(isNumber, oneOf([false, MPV_CHOICES.auto]))),
  [MPV_PROPERTIES.vid]: nullable(union(isNumber, oneOf([false, MPV_CHOICES.auto]))),
  [MPV_PROPERTIES.trackList]: listOf(isMpvTrack),
  [MPV_PROPERTIES.containerFps]: nullable(isNumber),
  [MPV_PROPERTIES.audioDeviceList]: listOf(object({ name: isString, description: isString })),
  [MPV_PROPERTIES.demuxerCacheState]: nullable(
    object({
      'seekable-ranges': listOf(object({ start: isNumber, end: isNumber })),
      // Bytes a second the stream is reading, which tells a slow server from one that went quiet.
      'raw-input-rate': optional(isNumber),
    }),
  ),
  [MPV_PROPERTIES.hwdecCurrent]: isString,
  [MPV_PROPERTIES.frameDropCount]: isNumber,
  [MPV_PROPERTIES.decoderFrameDropCount]: isNumber,
  [MPV_PROPERTIES.displayFpsOverride]: isNumber,
  [MPV_PROPERTIES.targetColorspaceHint]: union(isBoolean, oneOf([MPV_CHOICES.auto])),
} as const satisfies { [K in MpvProperty]: Guard<unknown> }

export type MpvPropertyValue<K extends MpvProperty> = Infer<(typeof propertyGuards)[K]>
