import { isMediaTracks } from '@/contract'
import {
  type Infer,
  isBoolean,
  isNumber,
  isString,
  listOf,
  nullable,
  object,
  oneOf,
  union,
} from '@/schema'

export const PLAYER_SOURCE_KINDS = { server: 'server', file: 'file' } as const

/**
 * What the player opens. The renderer names a server title or a file the
 * main process granted it, never a path or a URL.
 */
export const isPlayerSource = union(
  object({ kind: oneOf([PLAYER_SOURCE_KINDS.server]), serverId: isString, mediaId: isNumber }),
  object({ kind: oneOf([PLAYER_SOURCE_KINDS.file]), fileId: isString }),
)

export type PlayerSource = Infer<typeof isPlayerSource>

export const PLAYER_COMMANDS = {
  load: 'load',
  play: 'play',
  pause: 'pause',
  seek: 'seek',
  audio: 'audio',
  subtitle: 'subtitle',
  volume: 'volume',
  speed: 'speed',
  subtitleScale: 'subtitleScale',
  stats: 'stats',
  stop: 'stop',
} as const

export const isPlayerCommand = union(
  object({
    type: oneOf([PLAYER_COMMANDS.load]),
    source: isPlayerSource,
    start: isNumber,
    audio: nullable(isNumber),
    subtitle: nullable(isString),
  }),
  object({ type: oneOf([PLAYER_COMMANDS.play]) }),
  object({ type: oneOf([PLAYER_COMMANDS.pause]) }),
  object({ type: oneOf([PLAYER_COMMANDS.seek]), time: isNumber }),
  object({ type: oneOf([PLAYER_COMMANDS.audio]), index: nullable(isNumber) }),
  object({ type: oneOf([PLAYER_COMMANDS.subtitle]), id: nullable(isString) }),
  object({ type: oneOf([PLAYER_COMMANDS.volume]), volume: isNumber, muted: isBoolean }),
  object({ type: oneOf([PLAYER_COMMANDS.speed]), rate: isNumber }),
  object({ type: oneOf([PLAYER_COMMANDS.subtitleScale]), scale: isNumber }),
  object({ type: oneOf([PLAYER_COMMANDS.stats]) }),
  object({ type: oneOf([PLAYER_COMMANDS.stop]) }),
)

export type PlayerCommand = Infer<typeof isPlayerCommand>

const isTimeRange = object({ start: isNumber, end: isNumber })

export const PLAYER_ERROR_REASONS = {
  open: 'open',
  decode: 'decode',
  network: 'network',
  locked: 'locked',
  engine: 'engine',
  account: 'account',
} as const

export const isPlayerErrorReason = oneOf(Object.values(PLAYER_ERROR_REASONS))

export type PlayerErrorReason = Infer<typeof isPlayerErrorReason>

export const PLAYER_EVENTS = {
  time: 'time',
  buffered: 'buffered',
  paused: 'paused',
  waiting: 'waiting',
  duration: 'duration',
  rate: 'rate',
  tracks: 'tracks',
  ended: 'ended',
  error: 'error',
} as const

export const isPlayerEvent = union(
  object({ type: oneOf([PLAYER_EVENTS.time]), time: isNumber }),
  object({ type: oneOf([PLAYER_EVENTS.buffered]), ranges: listOf(isTimeRange) }),
  object({ type: oneOf([PLAYER_EVENTS.paused]), paused: isBoolean }),
  object({ type: oneOf([PLAYER_EVENTS.waiting]), waiting: isBoolean }),
  object({ type: oneOf([PLAYER_EVENTS.duration]), duration: nullable(isNumber) }),
  object({ type: oneOf([PLAYER_EVENTS.rate]), rate: isNumber }),
  object({ type: oneOf([PLAYER_EVENTS.tracks]), tracks: isMediaTracks }),
  object({ type: oneOf([PLAYER_EVENTS.ended]) }),
  object({
    type: oneOf([PLAYER_EVENTS.error]),
    reason: isPlayerErrorReason,
    message: isString,
  }),
)

export type PlayerEvent = Infer<typeof isPlayerEvent>

/** A command on the player's MessagePort, answered by a reply with the same id. */
export const isPlayerRequest = object({ id: isNumber, command: isPlayerCommand })

/** Why a command was refused: `engine` means the native engine is gone and will not answer again. */
export const PLAYER_REFUSAL_REASONS = { refused: 'refused', engine: 'engine' } as const

export const isPlayerRefusalReason = oneOf(Object.values(PLAYER_REFUSAL_REASONS))

export type PlayerRefusalReason = Infer<typeof isPlayerRefusalReason>

export const isPlayerReply = union(
  object({ id: isNumber, ok: oneOf([true]) }),
  object({ id: isNumber, ok: oneOf([false]), reason: isPlayerRefusalReason, message: isString }),
)

export const AUDIO_PROFILES = {
  pcm: 'pcm',
  passthrough: 'passthrough',
  headphones: 'headphones',
} as const

export const isAudioProfile = oneOf(Object.values(AUDIO_PROFILES))

/** mpv's `audio-spdif` vocabulary. */
export const PASSTHROUGH_FORMATS = {
  ac3: 'ac3',
  eac3: 'eac3',
  dts: 'dts',
  dtsHd: 'dts-hd',
  truehd: 'truehd',
} as const

export const isPassthroughFormat = oneOf(Object.values(PASSTHROUGH_FORMATS))

/** mpv's `audio-device` names raven knows by heart: `auto` follows the system. */
export const AUDIO_DEVICES = { auto: 'auto' } as const

export const isOutputSettings = object({
  profile: isAudioProfile,
  device: isString,
  passthrough: listOf(isPassthroughFormat),
  spatial: isBoolean,
})

export type AudioProfile = Infer<typeof isAudioProfile>
export type PassthroughFormat = Infer<typeof isPassthroughFormat>

/**
 * `device` is mpv's `audio-device` name, `AUDIO_DEVICES.auto` to follow the
 * system. `spatial` applies to the headphones profile only.
 */
export type OutputSettings = Infer<typeof isOutputSettings>

export const DEFAULT_OUTPUT_SETTINGS: OutputSettings = {
  profile: AUDIO_PROFILES.pcm,
  device: AUDIO_DEVICES.auto,
  passthrough: [PASSTHROUGH_FORMATS.ac3, PASSTHROUGH_FORMATS.dts],
  spatial: false,
}
