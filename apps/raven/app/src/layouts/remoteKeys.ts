import { oneOf } from '@raven/core'

import { SKIP_SECONDS } from '@/layouts/playerKit'

/** The remote's keys the d-pad player answers, as the fork's `useTVEventHandler` names them. */
export const REMOTE_KEYS = {
  left: 'left',
  right: 'right',
  up: 'up',
  down: 'down',
  select: 'select',
  playPause: 'playPause',
  play: 'play',
  pause: 'pause',
  rewind: 'rewind',
  fastForward: 'fastForward',
} as const

export type RemoteKey = (typeof REMOTE_KEYS)[keyof typeof REMOTE_KEYS]

const isRemoteKey = oneOf(Object.values(REMOTE_KEYS))

/** The names the fork's Android helper gives a key held down (only the d-pad and select). */
export const LONG_PRESS_NAMES = {
  longLeft: 'longLeft',
  longRight: 'longRight',
  longUp: 'longUp',
  longDown: 'longDown',
  longSelect: 'longSelect',
} as const

/** A key held down, by the fork's name for it, and the key it is. */
export const LONG_PRESSES = {
  [LONG_PRESS_NAMES.longLeft]: REMOTE_KEYS.left,
  [LONG_PRESS_NAMES.longRight]: REMOTE_KEYS.right,
  [LONG_PRESS_NAMES.longUp]: REMOTE_KEYS.up,
  [LONG_PRESS_NAMES.longDown]: REMOTE_KEYS.down,
  [LONG_PRESS_NAMES.longSelect]: REMOTE_KEYS.select,
} as const

// Its own keys only: `in` would also pass a name an object inherits, such as `toString`.
const isLongPress = (name: string): name is keyof typeof LONG_PRESSES =>
  Object.hasOwn(LONG_PRESSES, name)

/** Android's `KeyEvent` actions, which the fork hands on with each key. */
export const KEY_ACTIONS = { down: 0, up: 1 } as const

type PressedKeyOfProps = {
  eventType: string
  eventKeyAction?: unknown
}

/**
 * The key a remote event presses, once. On Android TV the fork sends a press as the key coming
 * up (its key-down events are off), and a key held down as its long name, once going down and
 * once coming up, so a press counts as it comes up, a held one as the key it is. The fork's
 * types call the action a string, but Android sends its `KeyEvent`'s, a number; an event naming
 * none counts.
 */
export const pressedKeyOf = ({
  eventType,
  eventKeyAction,
}: PressedKeyOfProps): RemoteKey | null => {
  if (eventKeyAction !== undefined && Number(eventKeyAction) !== KEY_ACTIONS.up) return null
  if (isLongPress(eventType)) return LONG_PRESSES[eventType]
  return isRemoteKey(eventType) ? eventType : null
}

/** Which way a held key carries the playhead: left back, right on, the rest not at all. */
const SEEK_DIRECTIONS: Partial<Record<RemoteKey, -1 | 1>> = {
  [REMOTE_KEYS.left]: -1,
  [REMOTE_KEYS.right]: 1,
}

/** A held left or right: which way it goes, and whether the key is going down or coming up. */
export type HeldSeek = { direction: -1 | 1; isDown: boolean }

type HeldSeekOfProps = {
  eventType: string
  eventKeyAction?: unknown
}

/**
 * A held left or right, going down or coming up; null for any other event. The fork names a held
 * key once as it goes down and once as it comes up, so the player runs the playhead between.
 */
export const heldSeekOf = ({ eventType, eventKeyAction }: HeldSeekOfProps): HeldSeek | null => {
  const direction = isLongPress(eventType) ? SEEK_DIRECTIONS[LONG_PRESSES[eventType]] : undefined
  return direction === undefined
    ? null
    : { direction, isDown: Number(eventKeyAction) === KEY_ACTIONS.down }
}

/** What a press does beyond bringing the controls back: a seek, in seconds, and a play or pause. */
type RemoteAnswer = { seekBy: number; shouldTogglePlay: boolean }

const NO_ANSWER: RemoteAnswer = { seekBy: 0, shouldTogglePlay: false }

type RemoteAnswerOfProps = {
  key: RemoteKey
  isShown: boolean
  isScrubbing: boolean
  isPaused: boolean
}

type IsSeekingWithProps = Pick<RemoteAnswerOfProps, 'isShown' | 'isScrubbing'>

/** Whether left and right seek: from the scrubber, or while the controls are hidden. */
export const isSeekingWith = ({ isShown, isScrubbing }: IsSeekingWithProps): boolean =>
  isScrubbing || !isShown

/**
 * What the d-pad player does with a press. Left and right skip ten seconds from the scrubber,
 * or while the controls are hidden, as the press brings them back; on the buttons they move the
 * focus instead. Rewind and fast forward skip wherever the focus is, and the play keys play and
 * pause. Every press brings the controls back, which the chrome does for any key.
 */
export const remoteAnswerOf = ({
  key,
  isShown,
  isScrubbing,
  isPaused,
}: RemoteAnswerOfProps): RemoteAnswer => {
  const isSeeking = isSeekingWith({ isShown, isScrubbing })
  switch (key) {
    case REMOTE_KEYS.left:
      return isSeeking ? { ...NO_ANSWER, seekBy: -SKIP_SECONDS } : NO_ANSWER
    case REMOTE_KEYS.right:
      return isSeeking ? { ...NO_ANSWER, seekBy: SKIP_SECONDS } : NO_ANSWER
    case REMOTE_KEYS.rewind:
      return { ...NO_ANSWER, seekBy: -SKIP_SECONDS }
    case REMOTE_KEYS.fastForward:
      return { ...NO_ANSWER, seekBy: SKIP_SECONDS }
    case REMOTE_KEYS.playPause:
      return { ...NO_ANSWER, shouldTogglePlay: true }
    case REMOTE_KEYS.play:
      return { ...NO_ANSWER, shouldTogglePlay: isPaused }
    case REMOTE_KEYS.pause:
      return { ...NO_ANSWER, shouldTogglePlay: !isPaused }
    case REMOTE_KEYS.up:
    case REMOTE_KEYS.down:
    case REMOTE_KEYS.select:
      return NO_ANSWER
    default: {
      const unknown: never = key
      return unknown
    }
  }
}
