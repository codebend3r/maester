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

export const isMpvTrack = object({
  id: isNumber,
  type: oneOf(['audio', 'sub', 'video']),
  selected: optional(isBoolean),
  default: optional(isBoolean),
  external: optional(isBoolean),
  lang: optional(isString),
  title: optional(isString),
  codec: optional(isString),
  'demux-channel-count': optional(isNumber),
})
export type MpvTrack = Infer<typeof isMpvTrack>

export const propertyGuards = {
  'mpv-version': isString,
  'options/config': isBoolean,
  'options/load-scripts': isBoolean,
  'options/ytdl': isBoolean,
  'options/osc': isBoolean,
  'options/input-default-bindings': isBoolean,
  'options/input-vo-keyboard': isBoolean,
  'ffmpeg-version': isString,
  'time-pos': nullable(isNumber),
  duration: nullable(isNumber),
  pause: isBoolean,
  'paused-for-cache': isBoolean,
  seeking: isBoolean,
  speed: isNumber,
  aid: nullable(union(isNumber, oneOf([false, 'auto']))),
  sid: nullable(union(isNumber, oneOf([false, 'auto']))),
  'track-list': listOf(isMpvTrack),
  'container-fps': nullable(isNumber),
  'audio-device-list': listOf(object({ name: isString, description: isString })),
  'demuxer-cache-state': nullable(
    object({
      'seekable-ranges': listOf(object({ start: isNumber, end: isNumber })),
    }),
  ),
  'hwdec-current': isString,
  'frame-drop-count': isNumber,
  'decoder-frame-drop-count': isNumber,
  'display-fps-override': isNumber,
  'target-colorspace-hint': union(isBoolean, oneOf(['auto'])),
} as const

export type MpvProperty = keyof typeof propertyGuards
export type MpvPropertyValue<K extends MpvProperty> = Infer<(typeof propertyGuards)[K]>
