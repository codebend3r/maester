/**
 * How AVPlayer is started on the spot to resume from. `react-native-video` 6.19.3's own
 * `startPosition` runs, once the item is ready, `setSeek` (which pauses the player and resumes
 * it only when the seek lands) and then, before it has landed, `applyModifiers`, which asks
 * the player to play again: two plays around a far seek in a large file, and a player that
 * `waitsToMinimizeStalling` answers with `waitingToPlayAtSpecifiedRate`, a state the library
 * reports to nobody. So the video loads paused, is seeked once it has loaded, and is let play
 * only when that seek has landed.
 */

/** How long a resume seek may take to report before the video plays anyway. */
export const SEEK_GRACE_MS = 3_000

export const START_PHASES = { seeking: 'seeking', started: 'started' } as const

type StartPhase = (typeof START_PHASES)[keyof typeof START_PHASES]

/** Which attempt has loaded, and whether its resume seek has landed; attempts only count up. */
export type StartState = { attempt: number; phase: StartPhase } | null

export const START_EVENTS = { loaded: 'loaded', landed: 'landed' } as const

export type StartEvent =
  | { type: typeof START_EVENTS.loaded; attempt: number; at: number }
  | { type: typeof START_EVENTS.landed; attempt: number }

export const NOT_LOADED: StartState = null

export const startReducer = (state: StartState, event: StartEvent): StartState => {
  switch (event.type) {
    case START_EVENTS.loaded:
      if (state !== null && event.attempt <= state.attempt) return state
      return {
        attempt: event.attempt,
        phase: event.at > 0 ? START_PHASES.seeking : START_PHASES.started,
      }
    case START_EVENTS.landed:
      if (state === null || state.attempt !== event.attempt) return state
      return { attempt: event.attempt, phase: START_PHASES.started }
    default: {
      const unknown: never = event
      return unknown
    }
  }
}

type IsStartedProps = { state: StartState; attempt: number | null }

/** Whether `attempt`'s video has loaded and its resume seek has landed, so it may play. */
export const isStartedOf = ({ state, attempt }: IsStartedProps): boolean =>
  state !== null && state.attempt === attempt && state.phase === START_PHASES.started

/** Whether the latest video to load is waiting on its resume seek. */
export const isHeldOf = (state: StartState): boolean =>
  state !== null && state.phase === START_PHASES.seeking
