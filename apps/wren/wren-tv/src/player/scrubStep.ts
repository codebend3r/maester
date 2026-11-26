import { isRecord } from '@raven/core'

/** The remote's keys the scrubber answers, as the fork's `useTVEventHandler` names them. */
export const SCRUB_KEYS = { left: 'left', right: 'right' } as const

type ScrubKey = (typeof SCRUB_KEYS)[keyof typeof SCRUB_KEYS]

/** Which way each key moves the playhead: left back, right on. */
const SCRUB_DIRECTIONS = {
  [SCRUB_KEYS.left]: -1,
  [SCRUB_KEYS.right]: 1,
} as const satisfies Record<ScrubKey, -1 | 1>

const isScrubKey = (name: string): name is ScrubKey => Object.hasOwn(SCRUB_DIRECTIONS, name)

/** How far one press moves the playhead, in seconds: the phone's screen reader's step. */
export const SCRUB_STEP = 15

/** Android's `KeyEvent` action for a key coming up, which the fork hands on with each key. */
const KEY_UP = 1

type ScrubStepOfProps = {
  /** What the remote sent, as the fork hands it to a listener. */
  event: unknown
  /** Seconds into the track now. */
  position: number
  /** The track's length, in seconds. */
  length: number
}

/**
 * Where a press of left or right on the scrubber moves the playhead: `SCRUB_STEP` seconds back or
 * on, held between the start and the end; null for any other key. Android TV sends a key as it
 * goes down and as it comes up, so only its coming up counts; tvOS names no action.
 */
export const scrubStepOf = ({ event, position, length }: ScrubStepOfProps): number | null => {
  if (!isRecord(event) || typeof event.eventType !== 'string') return null
  const action = event.eventKeyAction
  if (action !== undefined && action !== null && Number(action) !== KEY_UP) return null
  if (!isScrubKey(event.eventType)) return null
  const to = position + SCRUB_DIRECTIONS[event.eventType] * SCRUB_STEP
  return Math.min(Math.max(to, 0), Math.max(length, 0))
}
