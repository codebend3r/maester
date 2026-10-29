import { SKIP_SECONDS } from '@/layouts/playerKit'
import type { HeldSeek } from '@/layouts/remoteKeys'

/** How often a hold moves the playhead along. */
export const HOLD_TICK_MS = 200

/** How long into a hold the playhead goes faster, and the seconds each tick carries it. */
const HOLD_SPEEDS = [
  { after: 0, seconds: SKIP_SECONDS },
  { after: 2000, seconds: 30 },
  { after: 5000, seconds: 60 },
] as const

/** The seconds one tick carries the playhead `heldMs` into a hold: faster the longer it is held. */
export const holdStepOf = (heldMs: number): number =>
  HOLD_SPEEDS.reduce<number>((step, speed) => (heldMs >= speed.after ? speed.seconds : step), 0)

/** A held left or right as it runs: which way, since when, and where it has carried the playhead. */
export type Hold = { direction: HeldSeek['direction']; startedAt: number; at: number }

export const HOLD_ACTIONS = { down: 'down', tick: 'tick', up: 'up' } as const

type HoldAction =
  | { type: typeof HOLD_ACTIONS.down; direction: Hold['direction']; at: number; now: number }
  | { type: typeof HOLD_ACTIONS.tick; now: number; duration: number | null }
  | { type: typeof HOLD_ACTIONS.up }

/**
 * A hold from the key going down to it coming up: it starts where the video is, each tick carries
 * it on by `holdStepOf` (faster the longer it is held), never past the start or the end, and it
 * ends as the key comes up, when the player seeks once to where it got.
 */
export const holdReducer = (hold: Hold | null, action: HoldAction): Hold | null => {
  switch (action.type) {
    case HOLD_ACTIONS.down:
      return { direction: action.direction, startedAt: action.now, at: action.at }
    case HOLD_ACTIONS.tick: {
      if (hold === null) return null
      const moved = Math.max(0, hold.at + hold.direction * holdStepOf(action.now - hold.startedAt))
      return { ...hold, at: action.duration === null ? moved : Math.min(action.duration, moved) }
    }
    case HOLD_ACTIONS.up:
      return null
    default: {
      const unknown: never = action
      return unknown
    }
  }
}
