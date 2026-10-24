import type { VideoState } from '@/components/Player/videoState'

/** How far the clock moves from the last saved spot before the spot is saved again, in seconds. */
export const SAVE_EVERY_S = 10

/** What a change in the player's state means for the viewer's progress. */
type ProgressStep = {
  /** Frames are flowing for the first time: the play is the server's to record. */
  isStarting: boolean
  /** The spot to save now, or null for none. */
  saveAt: number | null
}

/**
 * Whether playback has just started and what to save, from one state to the next. Nothing is
 * saved before it starts, so a player that never played leaves the resume spot alone. The end
 * saves the length (or where the video is, when the length is unknown); a pause, or the clock
 * moving `SAVE_EVERY_S` from the last save, saves the position.
 */
export const progressStepOf = ({
  state,
  previous,
  hasStarted,
  lastSaved,
  position,
  duration,
}: {
  state: VideoState
  previous: VideoState
  hasStarted: boolean
  lastSaved: number
  position: number
  duration: number | null
}): ProgressStep => {
  const isStarting = !hasStarted && !state.paused && !state.waiting
  const at = (() => {
    if (!hasStarted && !isStarting) return null
    if (state.ended && !previous.ended) return duration ?? position
    if (state.paused && !previous.paused) return position
    return Math.abs(state.time - lastSaved) >= SAVE_EVERY_S ? position : null
  })()
  return { isStarting, saveAt: at !== null && Number.isFinite(at) ? at : null }
}
