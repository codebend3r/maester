import type { MpvTrack } from '@raven/mpv'
import type { LoadTarget } from '@/main/player/loadTarget'
import { PLAYER_PHASES } from '@/main/player/phases'

/** The tracks the page asked for: an audio track's index and a subtitle's id, or mpv's own pick. */
export type Wanted = { audio: number | null; subtitle: string | null }

/** One load, from the moment its source resolved until it ends or a newer one replaces it. */
export type Title = {
  /** The load's ticket, which a stall marks so the load still waiting on mpv answers a lost connection. */
  ticket: number
  /**
   * Counted up by each load and never by a file-loaded: a replaced file's file-loaded can land
   * while a load waits on mpv, and must not make that load think it was overtaken.
   */
  generation: number
  target: LoadTarget
  /** Where the file was asked to start. */
  loadStart: number
  wanted: Wanted
  /** A seek asked for while the file opened, sent once it has. */
  pendingSeek: number | null
}

/** What the service knows of the file mpv has open. */
export type FileState = {
  /** The newest time mpv gave or the service sent, which the short-eof check reads. */
  lastTime: number | null
  duration: number | null
  trackList: readonly MpvTrack[]
  frameRate: number | null
  isPausedForCache: boolean
  isSeeking: boolean
  /** Waiting on the cache or a seek, as the page last heard. */
  isWaiting: boolean
  isAwaitingFirstFrame: boolean
}

/** Where the player is, with what that phase alone holds. */
export type PlayerState =
  | { phase: typeof PLAYER_PHASES.idle }
  | { phase: typeof PLAYER_PHASES.dead }
  | { phase: typeof PLAYER_PHASES.loading; title: Title }
  | { phase: typeof PLAYER_PHASES.loaded; title: Title; file: FileState }

export type LoadedState = Extract<PlayerState, { phase: typeof PLAYER_PHASES.loaded }>

export type ShowingState = Extract<PlayerState, { title: Title }>

export const IDLE: PlayerState = { phase: PLAYER_PHASES.idle }

export const DEAD: PlayerState = { phase: PLAYER_PHASES.dead }

/** A newly opened file: the addon's time-pos throttle can drop every update before an early eof, so it starts where it was asked to. */
export const freshFile = (title: Title): FileState => ({
  lastTime: title.loadStart,
  duration: null,
  trackList: [],
  frameRate: null,
  isPausedForCache: false,
  isSeeking: false,
  isWaiting: false,
  isAwaitingFirstFrame: true,
})

export const isShowing = (state: PlayerState): state is ShowingState =>
  state.phase === PLAYER_PHASES.loading || state.phase === PLAYER_PHASES.loaded

export const isLoaded = (state: PlayerState): state is LoadedState =>
  state.phase === PLAYER_PHASES.loaded

/** The title on screen, or null while none is. */
export const titleOf = (state: PlayerState): Title | null => (isShowing(state) ? state.title : null)
