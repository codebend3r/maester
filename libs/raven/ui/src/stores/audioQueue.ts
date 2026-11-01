import {
  EMPTY_QUEUE,
  type Queue,
  type QueueSource,
  RESTART_AFTER_S,
  type Track,
  afterEnd,
  append,
  currentOf,
  insertNext,
  jump,
  move,
  next,
  nextRepeat,
  previous,
  remove,
  setRepeat,
  shuffle,
  startQueue,
  unshuffle,
} from '@raven/core'
import { create } from 'zustand'
import { devtools } from 'zustand/middleware'

/** What the audio player is doing. */
export const AUDIO_STATES = {
  empty: 'empty',
  loading: 'loading',
  playing: 'playing',
  paused: 'paused',
  failed: 'failed',
} as const

export type AudioState = (typeof AUDIO_STATES)[keyof typeof AUDIO_STATES]

/** A seek the engine has yet to carry out: where to, and a count so the same spot twice still seeks. */
type SeekRequest = { seconds: number; nonce: number }

type PlayTracksProps = {
  tracks: readonly Track[]
  startAt?: number
  source?: QueueSource | null
  /** Whether to play them in a random order from the first of it. */
  isShuffled?: boolean
}

type MoveProps = { from: number; to: number }

type EngineTimeProps = { position: number; duration: number | null }

export type AudioQueueState = {
  queue: Queue
  /** Every queued track by its id, so the queue page and the bar need no fetch. */
  tracks: Record<number, Track>
  state: AudioState
  /** Playback intent, kept apart from asynchronous engine state reports. */
  shouldPlay: boolean
  /** Seconds into the playing track, as the engine last said. */
  position: number
  duration: number | null
  /** Why playback failed, for the bar; null otherwise. */
  error: string | null
  /** The engine carries this out and clears it. */
  seek: SeekRequest | null
  /** Replaces the queue with `tracks` and plays from `startAt`. */
  playTracks: (props: PlayTracksProps) => void
  /** Puts `tracks` right after the playing one; starts them when nothing plays. */
  playNext: (tracks: readonly Track[]) => void
  /** Adds `tracks` to the end; starts them when nothing plays. */
  addToQueue: (tracks: readonly Track[]) => void
  play: () => void
  pause: () => void
  toggle: () => void
  /** The next track; at the end with repeat off, the queue runs out. */
  next: () => void
  /** Restarts the track past `RESTART_AFTER_S` seconds, else the track before. */
  previous: () => void
  jump: (place: number) => void
  remove: (place: number) => void
  move: (props: MoveProps) => void
  toggleShuffle: () => void
  cycleRepeat: () => void
  seekTo: (seconds: number) => void
  clear: () => void
  /** The engine's word: what it is doing, where it is, that the track ended, or that it failed. */
  engine: {
    state: (state: Exclude<AudioState, typeof AUDIO_STATES.empty>) => void
    time: (props: EngineTimeProps) => void
    ended: () => void
    failed: (message: string) => void
    sought: () => void
  }
}

type TracksByIdProps = {
  known: Record<number, Track>
  tracks: readonly Track[]
}

const tracksById = ({ known, tracks }: TracksByIdProps): Record<number, Track> =>
  tracks.reduce((all, track) => ({ ...all, [track.id]: track }), known)

type AfterMoveProps = {
  before: Queue
  after: Queue
}

/** What the player state becomes once the queue moved: loading a new track, empty when it ran out, else as it was. */
const stateAfter = ({ before, after }: AfterMoveProps): Partial<AudioQueueState> => {
  const was = currentOf(before)
  const now = currentOf(after)
  if (now === null)
    return { state: AUDIO_STATES.empty, shouldPlay: false, position: 0, duration: null, seek: null }
  if (now === was && after.at === before.at) return {}
  return {
    state: AUDIO_STATES.loading,
    shouldPlay: true,
    position: 0,
    duration: null,
    error: null,
    seek: null,
  }
}

/**
 * The queue every raven client plays music from, above the routes, so
 * leaving a page stops nothing. The queue itself is core's; this holds it
 * with what the engine reports, and the engine (an `<audio>` element on the
 * web, mpv on the desktop) follows it.
 */
export const useAudioQueue = create<AudioQueueState>()(
  devtools(
    (set, get) => {
      /** Moves the queue, with the player state that follows. */
      const moveQueue = (step: (queue: Queue) => Queue): void => {
        const before = get().queue
        const after = step(before)
        set({ queue: after, ...stateAfter({ before, after }) })
      }
      return {
        queue: EMPTY_QUEUE,
        tracks: {},
        state: AUDIO_STATES.empty,
        shouldPlay: false,
        position: 0,
        duration: null,
        error: null,
        seek: null,
        playTracks: ({ tracks, startAt = 0, source = null, isShuffled = false }) => {
          const queue = startQueue({
            items: tracks.map((track) => track.id),
            startAt,
            source,
            repeat: get().queue.repeat,
            isShuffled,
          })
          set({
            queue,
            tracks: tracksById({ known: {}, tracks }),
            state: queue.at === null ? AUDIO_STATES.empty : AUDIO_STATES.loading,
            shouldPlay: queue.at !== null,
            position: 0,
            duration: null,
            error: null,
            seek: null,
          })
        },
        playNext: (tracks) => {
          set({ tracks: tracksById({ known: get().tracks, tracks }) })
          moveQueue((queue) => insertNext({ queue, ids: tracks.map((track) => track.id) }))
        },
        addToQueue: (tracks) => {
          set({ tracks: tracksById({ known: get().tracks, tracks }) })
          moveQueue((queue) => append({ queue, ids: tracks.map((track) => track.id) }))
        },
        play: () => {
          const { state, shouldPlay } = get()
          if (!shouldPlay && state !== AUDIO_STATES.empty && state !== AUDIO_STATES.failed)
            set({ state: AUDIO_STATES.playing, shouldPlay: true })
        },
        pause: () => {
          if (get().shouldPlay) set({ state: AUDIO_STATES.paused, shouldPlay: false })
        },
        toggle: () => {
          if (get().shouldPlay) return get().pause()
          get().play()
        },
        next: () => moveQueue(next),
        previous: () => {
          const { position, seek } = get()
          if (position > RESTART_AFTER_S) {
            set({ seek: { seconds: 0, nonce: (seek?.nonce ?? 0) + 1 }, position: 0 })
            return
          }
          moveQueue(previous)
        },
        jump: (place) => moveQueue((queue) => jump({ queue, place })),
        remove: (place) => moveQueue((queue) => remove({ queue, place })),
        move: ({ from, to }) => moveQueue((queue) => move({ queue, from, to })),
        toggleShuffle: () =>
          moveQueue((queue) => (queue.isShuffled ? unshuffle(queue) : shuffle({ queue }))),
        cycleRepeat: () =>
          moveQueue((queue) => setRepeat({ queue, repeat: nextRepeat(queue.repeat) })),
        seekTo: (seconds) => {
          if (get().state === AUDIO_STATES.empty) return
          set({ seek: { seconds, nonce: (get().seek?.nonce ?? 0) + 1 }, position: seconds })
        },
        clear: () =>
          set({
            queue: { ...EMPTY_QUEUE, repeat: get().queue.repeat },
            tracks: {},
            state: AUDIO_STATES.empty,
            shouldPlay: false,
            position: 0,
            duration: null,
            error: null,
            seek: null,
          }),
        engine: {
          state: (state) => {
            if (get().state !== AUDIO_STATES.empty) set({ state })
          },
          time: ({ position, duration }) => set({ position, duration }),
          ended: () => {
            const before = get().queue
            const after = afterEnd(before)
            // The same track again (repeat one, or repeat all with one track): a restart,
            // since nothing about the queue changes for an engine to see.
            if (
              currentOf(after) !== null &&
              currentOf(after) === currentOf(before) &&
              after.at === before.at
            ) {
              set({
                seek: { seconds: 0, nonce: (get().seek?.nonce ?? 0) + 1 },
                position: 0,
                state: AUDIO_STATES.loading,
                shouldPlay: true,
              })
              return
            }
            moveQueue(afterEnd)
          },
          failed: (message) =>
            set({ state: AUDIO_STATES.failed, shouldPlay: false, error: message }),
          sought: () => set({ seek: null }),
        },
      }
    },
    { name: 'raven/audioQueue' },
  ),
)

/** The track playing, with its details, or null for none. */
export const playingTrackOf = (state: AudioQueueState): Track | null => {
  const id = currentOf(state.queue)
  return id === null ? null : (state.tracks[id] ?? null)
}

/** The track after the playing one in play order, for preloading; null for none. */
export const nextTrackOf = (state: AudioQueueState): Track | null => {
  const id = currentOf(afterEnd(state.queue))
  const playing = currentOf(state.queue)
  return id === null || id === playing ? null : (state.tracks[id] ?? null)
}
