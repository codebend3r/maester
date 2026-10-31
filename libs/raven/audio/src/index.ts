import { type EventSubscription, requireNativeModule } from 'expo-modules-core'
import {
  type AudioItem,
  type AudioPlayerEvent,
  type BrowseNode,
  isAudioPlayerEvent,
} from '@/contract'

export {
  AUDIO_PLAYER_EVENTS,
  type AudioItem,
  type AudioPlayerEvent,
  BROWSE_ROOTS,
  type BrowseNode,
  isAudioPlayerEvent,
  isBrowseNode,
} from '@/contract'

/** The one event the native side emits, carrying every player event as its payload. */
const NATIVE_EVENT = 'onAudioEvent'

type NativeAudioModule = {
  /**
   * Replaces the player's window, `items` in play order, and plays the first from `start`
   * seconds or holds it paused there.
   */
  setWindow: (items: AudioItem[], shouldPlay: boolean, start: number) => Promise<void>
  /** Replaces what follows the playing item; an empty list clears it. */
  setNext: (items: AudioItem[]) => Promise<void>
  play: () => Promise<void>
  pause: () => Promise<void>
  seekTo: (seconds: number) => Promise<void>
  setVolume: (volume: number) => Promise<void>
  /** How fast every item plays, kept across items and windows until it is set again. */
  setRate: (rate: number) => Promise<void>
  stop: () => Promise<void>
  /** Answers the `browse` event of `requestId` with the children it asked for. */
  answerBrowse: (requestId: string, nodes: BrowseNode[]) => Promise<void>
  addListener: (name: typeof NATIVE_EVENT, listener: (event: unknown) => void) => EventSubscription
}

/** The rates the player is asked for: AVFoundation keeps speech clear between these. */
const RATE_RANGE = { min: 0.5, max: 2 } as const

let cached: NativeAudioModule | null = null

/**
 * The native module, looked up on first use rather than at import, so a TV, which plays music
 * through the video player and imports this package beside it, never wakes the native player.
 */
const native = (): NativeAudioModule => {
  cached ??= requireNativeModule<NativeAudioModule>('RavenAudio')
  return cached
}

type SetWindowProps = {
  playing: AudioItem
  next: AudioItem | null
  shouldPlay: boolean
  /** Seconds into `playing` to start at: an audiobook's saved spot, else 0. */
  start: number
}

type AnswerBrowseProps = {
  /** The `browse` event's own id, so native matches the answer to its request. */
  requestId: string
  nodes: BrowseNode[]
}

type OnEventProps = {
  listener: (event: AudioPlayerEvent) => void
  /** Hears an event the native side sent in a shape this contract does not know. */
  onUnknown: (event: unknown) => void
}

/** The music player on iPhones and iPads: `AVQueuePlayer`, with Now Playing and the lock screen. */
export const audioPlayer = {
  setWindow: ({ playing, next, shouldPlay, start }: SetWindowProps): Promise<void> =>
    native().setWindow(next === null ? [playing] : [playing, next], shouldPlay, Math.max(0, start)),
  setNext: (next: AudioItem | null): Promise<void> => native().setNext(next === null ? [] : [next]),
  play: (): Promise<void> => native().play(),
  pause: (): Promise<void> => native().pause(),
  seekTo: (seconds: number): Promise<void> => native().seekTo(Math.max(0, seconds)),
  setVolume: (volume: number): Promise<void> =>
    native().setVolume(Math.min(1, Math.max(0, volume))),
  /** How fast it plays, 1 as recorded: an audiobook's speed, or 1 for music. */
  setRate: (rate: number): Promise<void> =>
    native().setRate(Math.min(RATE_RANGE.max, Math.max(RATE_RANGE.min, rate))),
  stop: (): Promise<void> => native().stop(),
  /** Gives CarPlay or Android Auto the list a `browse` event asked for. */
  answerBrowse: ({ requestId, nodes }: AnswerBrowseProps): Promise<void> =>
    native().answerBrowse(requestId, nodes),
  /** Hears the player; the subscription's `remove` stops it. */
  onEvent: ({ listener, onUnknown }: OnEventProps): EventSubscription =>
    native().addListener(NATIVE_EVENT, (event) => {
      if (isAudioPlayerEvent(event)) {
        listener(event)
        return
      }
      onUnknown(event)
    }),
} as const

export type AudioPlayer = typeof audioPlayer
