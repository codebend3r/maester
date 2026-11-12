import { SKIP_WINDOW_MS, type SkipStep } from '@/shortcuts'

/** Two taps this close together on one side of the picture are a double tap. */
export const DOUBLE_TAP_MS = 300

/** How long a finger rests on the picture before its hold starts. */
export const TOUCH_HOLD_DELAY_MS = 500

/** How fast a hold plays, forward on the right and backwards on the left. */
export const TOUCH_HOLD_RATE = 2

/** How often a hold backwards moves the picture. */
export const TOUCH_REWIND_TICK_MS = 250

/** A side of the picture, as the direction its skip goes: the left back, the right forward. */
export type TouchSide = SkipStep['direction']

type TouchSideOfProps = {
  /** Where the finger is, from the picture's left edge. */
  x: number
  width: number
}

/** The half of the picture a finger is on. */
export const touchSideOf = ({ x, width }: TouchSideOfProps): TouchSide => (x < width / 2 ? -1 : 1)

/** One tap on the picture: which side, when, in milliseconds, and whether it skipped. */
export type SurfaceTap = { side: TouchSide; at: number; isSkip: boolean }

type StepTapProps = {
  last: SurfaceTap | null
  side: TouchSide
  at: number
}

/**
 * What a tap on the picture is: a skip when it is the second of a double tap on one side, or
 * when it follows a skip on that side within the window quick skips climb in (`stepSkip`'s), so
 * a third and a fourth tap go on skipping; otherwise a lone tap, which the player answers its
 * own way.
 */
export const stepTap = ({ last, side, at }: StepTapProps): SurfaceTap => {
  const isRunning = last?.isSkip ?? false
  const window = isRunning ? SKIP_WINDOW_MS : DOUBLE_TAP_MS
  const isSkip = last !== null && last.side === side && at - last.at < window
  return { side, at, isSkip }
}

type RewoundToProps = {
  /** Where the video was as the hold started, in seconds. */
  from: number
  /** How long the hold has run, in milliseconds. */
  heldMs: number
}

/** Where a hold backwards has carried the video: back at the hold's rate, never past the start. */
export const rewoundTo = ({ from, heldMs }: RewoundToProps): number =>
  Math.max(0, from - (TOUCH_HOLD_RATE * heldMs) / 1000)
