import type { SkipStep } from '@raven/core'
import {
  KEY_ACTIONS,
  LONG_PRESSES,
  REMOTE_KEYS,
  type RemoteKey,
  isLongPress,
} from '@raven/native/headless'

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

/** What a press does beyond bringing the controls back: a skip one way, and a play or pause. */
type RemoteAnswer = { skip: SkipStep['direction'] | null; shouldTogglePlay: boolean }

const NO_ANSWER: RemoteAnswer = { skip: null, shouldTogglePlay: false }

type RemoteAnswerOfProps = {
  key: RemoteKey
  isShown: boolean
  isScrubbing: boolean
  isPaused: boolean
}

/** What on the player the remote's focus is on. */
export const REMOTE_HOLDERS = {
  /** Nothing drawn: the hidden state's catcher, where left and right seek. */
  catcher: 'catcher',
  controls: 'controls',
  /** The up next card's buttons, which keep the remote whether or not the controls show. */
  upNext: 'upNext',
  /** Skip intro's card over the intro's first seconds, and Undo skip's after it skipped itself. */
  intro: 'intro',
} as const

export type RemoteHolder = (typeof REMOTE_HOLDERS)[keyof typeof REMOTE_HOLDERS]

type RemoteHolderOfProps = {
  isVisible: boolean
  isUpNextOffered: boolean
  isIntroPrompting: boolean
}

/**
 * Who has the remote: the up next card while it is offered, else Skip intro's card while it
 * prompts, else the controls while they show.
 */
export const remoteHolderOf = ({
  isVisible,
  isUpNextOffered,
  isIntroPrompting,
}: RemoteHolderOfProps): RemoteHolder => {
  if (isUpNextOffered) return REMOTE_HOLDERS.upNext
  if (isIntroPrompting) return REMOTE_HOLDERS.intro
  return isVisible ? REMOTE_HOLDERS.controls : REMOTE_HOLDERS.catcher
}

type IsSeekingWithProps = Pick<RemoteAnswerOfProps, 'isShown' | 'isScrubbing'>

/** Whether left and right seek: from the scrubber, or while the controls are hidden. */
export const isSeekingWith = ({ isShown, isScrubbing }: IsSeekingWithProps): boolean =>
  isScrubbing || !isShown

/**
 * What the d-pad player does with a press. Left and right skip (how far is the chrome's skip
 * ladder's to say) from the scrubber,
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
      return isSeeking ? { ...NO_ANSWER, skip: -1 } : NO_ANSWER
    case REMOTE_KEYS.right:
      return isSeeking ? { ...NO_ANSWER, skip: 1 } : NO_ANSWER
    case REMOTE_KEYS.rewind:
      return { ...NO_ANSWER, skip: -1 }
    case REMOTE_KEYS.fastForward:
      return { ...NO_ANSWER, skip: 1 }
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
