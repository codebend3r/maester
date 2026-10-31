import { isAudioBitrate } from '@/contract/streaming'
import { isEqGains } from '@/equalizer'
import { isMediaId } from '@/playLink'
import { isPlayerErrorReason, PLAYER_ERROR_REASONS, type PlayerEvent } from '@/player'
import { type Infer, isBoolean, isNumber, isString, nullable, object, oneOf, union } from '@/schema'

/**
 * What the page asks of the desktop's music engine. The queue stays on the page, in
 * the shared store: main hears one track and the one after it, so mpv can run the two
 * together with no gap, and tells the page when it moved on by itself.
 */
export const AUDIO_COMMANDS = {
  load: 'load',
  queueNext: 'queueNext',
  play: 'play',
  pause: 'pause',
  seek: 'seek',
  volume: 'volume',
  speed: 'speed',
  nowPlaying: 'nowPlaying',
  sound: 'sound',
  stop: 'stop',
} as const

/** A levelling factor, as `levelOf` gives it: above 0, and never above 1, as levelling only turns down. */
const isLevel = (value: unknown): value is number => isNumber(value) && value > 0 && value <= 1

/** A cover rides along as its bytes, which the page already holds; main asks no picture route. */
export const ARTWORK_MAX_BYTES = 4 * 1024 * 1024

const isArtwork = (value: unknown): value is ArrayBuffer =>
  value instanceof ArrayBuffer && value.byteLength <= ARTWORK_MAX_BYTES

/** What the system shows for the playing track: on macOS, Control Center and the lock screen. */
export const isNowPlayingInfo = object({
  title: isString,
  artist: isString,
  album: isString,
  artwork: nullable(isArtwork),
})

export type NowPlayingInfo = Infer<typeof isNowPlayingInfo>

export const isAudioCommand = union(
  // Plays `mediaId` from `start`, with `next` ready to follow it, from the file itself, or both
  // from the server's AAC transcode at `kbps`.
  object({
    type: oneOf([AUDIO_COMMANDS.load]),
    mediaId: isMediaId,
    next: nullable(isMediaId),
    start: isNumber,
    kbps: nullable(isAudioBitrate),
  }),
  // Changes only what follows the playing track.
  object({ type: oneOf([AUDIO_COMMANDS.queueNext]), next: nullable(isMediaId) }),
  object({ type: oneOf([AUDIO_COMMANDS.play]) }),
  object({ type: oneOf([AUDIO_COMMANDS.pause]) }),
  object({ type: oneOf([AUDIO_COMMANDS.seek]), time: isNumber }),
  object({ type: oneOf([AUDIO_COMMANDS.volume]), volume: isNumber, muted: isBoolean }),
  // How fast it plays: an audiobook's chosen speed, 1 for music; the pitch stays as it was.
  object({ type: oneOf([AUDIO_COMMANDS.speed]), rate: isNumber }),
  object({ type: oneOf([AUDIO_COMMANDS.nowPlaying]), info: isNowPlayingInfo }),
  // How the playing track sounds: its levelling factor and the equalizer's gains, from 32 Hz up.
  object({ type: oneOf([AUDIO_COMMANDS.sound]), level: isLevel, eq: isEqGains }),
  object({ type: oneOf([AUDIO_COMMANDS.stop]) }),
)

export type AudioCommand = Infer<typeof isAudioCommand>

/** The system's transport controls, as the media keys and Control Center send them. */
export const REMOTE_COMMANDS = {
  play: 'play',
  pause: 'pause',
  toggle: 'toggle',
  next: 'next',
  previous: 'previous',
  stop: 'stop',
  seek: 'seek',
} as const

export const isRemoteCommand = union(
  object({
    kind: oneOf([
      REMOTE_COMMANDS.play,
      REMOTE_COMMANDS.pause,
      REMOTE_COMMANDS.toggle,
      REMOTE_COMMANDS.next,
      REMOTE_COMMANDS.previous,
      REMOTE_COMMANDS.stop,
    ]),
  }),
  object({ kind: oneOf([REMOTE_COMMANDS.seek]), time: isNumber }),
)

export type RemoteCommand = Infer<typeof isRemoteCommand>

export const AUDIO_EVENTS = {
  time: 'time',
  duration: 'duration',
  paused: 'paused',
  waiting: 'waiting',
  advanced: 'advanced',
  ended: 'ended',
  error: 'error',
  remote: 'remote',
} as const

export const isAudioEvent = union(
  object({ type: oneOf([AUDIO_EVENTS.time]), time: isNumber }),
  object({ type: oneOf([AUDIO_EVENTS.duration]), duration: nullable(isNumber) }),
  object({ type: oneOf([AUDIO_EVENTS.paused]), paused: isBoolean }),
  object({ type: oneOf([AUDIO_EVENTS.waiting]), waiting: isBoolean }),
  // mpv went on to the queued track by itself, with no gap.
  object({ type: oneOf([AUDIO_EVENTS.advanced]) }),
  // The track ended with nothing queued after it.
  object({ type: oneOf([AUDIO_EVENTS.ended]) }),
  object({
    type: oneOf([AUDIO_EVENTS.error]),
    reason: isPlayerErrorReason,
    message: isString,
  }),
  object({ type: oneOf([AUDIO_EVENTS.remote]), command: isRemoteCommand }),
)

export type AudioEvent = Infer<typeof isAudioEvent>

/** A command on the music port, answered by a reply with the same id, as the player's are. */
export const isAudioRequest = object({ id: isNumber, command: isAudioCommand })

/** The event an engine sends once when its mpv stops for good: the video player's, or the music engine's. */
export const isEngineStopEvent = <E extends PlayerEvent | AudioEvent>(
  event: E,
): event is Extract<E, { type: typeof AUDIO_EVENTS.error }> =>
  event.type === AUDIO_EVENTS.error && event.reason === PLAYER_ERROR_REASONS.engine
