import { type EventSubscription, requireNativeModule } from 'expo-modules-core'
import { type AudioItem, type AudioPlayerEvent, isAudioPlayerEvent } from '@/contract'

export {
  AUDIO_PLAYER_EVENTS,
  type AudioItem,
  type AudioPlayerEvent,
  isAudioPlayerEvent,
} from '@/contract'

/** The one event the native side emits, carrying every player event as its payload. */
const NATIVE_EVENT = 'onAudioEvent'

type NativeAudioModule = {
  /** Replaces the player's window, `items` in play order, and plays the first or holds it paused. */
  setWindow: (items: AudioItem[], shouldPlay: boolean) => Promise<void>
  /** Replaces what follows the playing item; an empty list clears it. */
  setNext: (items: AudioItem[]) => Promise<void>
  play: () => Promise<void>
  pause: () => Promise<void>
  seekTo: (seconds: number) => Promise<void>
  setVolume: (volume: number) => Promise<void>
  stop: () => Promise<void>
  addListener: (name: typeof NATIVE_EVENT, listener: (event: unknown) => void) => EventSubscription
}

let cached: NativeAudioModule | null = null

/**
 * The native module, looked up on first use rather than at import, so a TV, which plays music
 * through the video player and imports this package beside it, never wakes the native player.
 */
const native = (): NativeAudioModule => {
  cached ??= requireNativeModule<NativeAudioModule>('RavenAudio')
  return cached
}

type SetWindowProps = { playing: AudioItem; next: AudioItem | null; shouldPlay: boolean }

type OnEventProps = {
  listener: (event: AudioPlayerEvent) => void
  /** Hears an event the native side sent in a shape this contract does not know. */
  onUnknown: (event: unknown) => void
}

/** The music player on iPhones and iPads: `AVQueuePlayer`, with Now Playing and the lock screen. */
export const audioPlayer = {
  setWindow: ({ playing, next, shouldPlay }: SetWindowProps): Promise<void> =>
    native().setWindow(next === null ? [playing] : [playing, next], shouldPlay),
  setNext: (next: AudioItem | null): Promise<void> => native().setNext(next === null ? [] : [next]),
  play: (): Promise<void> => native().play(),
  pause: (): Promise<void> => native().pause(),
  seekTo: (seconds: number): Promise<void> => native().seekTo(Math.max(0, seconds)),
  setVolume: (volume: number): Promise<void> =>
    native().setVolume(Math.min(1, Math.max(0, volume))),
  stop: (): Promise<void> => native().stop(),
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
