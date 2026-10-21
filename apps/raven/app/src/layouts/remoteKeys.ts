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

/** A key held down, as the fork's Android helper names it (only the d-pad and select), and the key it is. */
export const LONG_PRESSES = {
  longLeft: REMOTE_KEYS.left,
  longRight: REMOTE_KEYS.right,
  longUp: REMOTE_KEYS.up,
  longDown: REMOTE_KEYS.down,
  longSelect: REMOTE_KEYS.select,
} as const

const isLongPress = (name: string): name is keyof typeof LONG_PRESSES => name in LONG_PRESSES

/** Android's `KeyEvent` actions, which the fork hands on with each key. */
export const KEY_ACTIONS = { down: 0, up: 1 } as const

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
}: {
  eventType: string
  eventKeyAction?: unknown
}): RemoteKey | null => {
  if (eventKeyAction !== undefined && Number(eventKeyAction) !== KEY_ACTIONS.up) return null
  if (isLongPress(eventType)) return LONG_PRESSES[eventType]
  return isRemoteKey(eventType) ? eventType : null
}

/** What a press does beyond bringing the controls back: a seek, in seconds, and a play or pause. */
type RemoteAnswer = { seekBy: number; shouldTogglePlay: boolean }

const NO_ANSWER: RemoteAnswer = { seekBy: 0, shouldTogglePlay: false }

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
}: {
  key: RemoteKey
  isShown: boolean
  isScrubbing: boolean
  isPaused: boolean
}): RemoteAnswer => {
  const isSeeking = isScrubbing || !isShown
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
