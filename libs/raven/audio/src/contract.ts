import {
  type Infer,
  isBoolean,
  isNumber,
  isString,
  nullable,
  object,
  oneOf,
  isRemoteCommand,
  union,
} from '@raven/core'

/**
 * One track as the native player takes it: its address with the headers it sends, the words
 * and cover the lock screen shows, and its length from the server, since AVFoundation rounds a
 * FLAC's up to whole blocks.
 */
export type AudioItem = {
  id: number
  uri: string
  headers: Record<string, string>
  title: string
  artist: string
  album: string
  artworkUri: string | null
  duration: number | null
}

export const AUDIO_PLAYER_EVENTS = {
  state: 'state',
  advanced: 'advanced',
  ended: 'ended',
  error: 'error',
  remote: 'remote',
} as const

/** What the native player reports: where it is, that it moved on by itself, ran out, or failed. */
export const isAudioPlayerEvent = union(
  object({
    type: oneOf([AUDIO_PLAYER_EVENTS.state]),
    position: isNumber,
    duration: nullable(isNumber),
    isPlaying: isBoolean,
    isBuffering: isBoolean,
  }),
  // The player went on to the next item of its window by itself.
  object({ type: oneOf([AUDIO_PLAYER_EVENTS.advanced]) }),
  // The playing item ended with nothing after it.
  object({ type: oneOf([AUDIO_PLAYER_EVENTS.ended]) }),
  object({ type: oneOf([AUDIO_PLAYER_EVENTS.error]), message: isString }),
  object({ type: oneOf([AUDIO_PLAYER_EVENTS.remote]), command: isRemoteCommand }),
)

export type AudioPlayerEvent = Infer<typeof isAudioPlayerEvent>
