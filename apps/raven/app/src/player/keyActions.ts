import {
  type HostAction,
  KEYS,
  type KeyPress,
  PLAYER_ACTIONS,
  PLAYER_ANSWERS,
  type PlayerAction,
  type PlayerAnswer,
  type SkipStep,
  resolvePlayerAction,
  shortcutFor,
} from '@raven/core'

import { SUBTITLE_CHOICES } from '@/player/playerTracks'

/*
 * Every key a hardware keyboard might offer the player: the letters and digits, the symbols the
 * web's table names, Space and the named keys. Core's `shortcutFor` is the one table of what each
 * does, so the keys the player takes from the system are the ones it answers, no list of its own.
 */
const KEY_CANDIDATES: readonly string[] = [
  ...'abcdefghijklmnopqrstuvwxyz0123456789,.<>+=-_?',
  ...Object.values(KEYS),
]

const UNMODIFIED = { metaKey: false, ctrlKey: false, altKey: false } as const

/** The keys the player answers under the thumb, by the web's `KeyboardEvent.key` names. */
export const PLAYER_KEYS: readonly string[] = KEY_CANDIDATES.filter(
  (key) => shortcutFor({ key, ...UNMODIFIED }) !== null,
)

export const KEY_ANSWERS = {
  seek: PLAYER_ANSWERS.seek,
  skip: 'skip',
  togglePlay: PLAYER_ANSWERS.togglePlay,
  volume: PLAYER_ANSWERS.volume,
  subtitle: 'subtitle',
  leave: 'leave',
} as const

/** What the touch chrome does for a key: the same as the button for it would. */
export type KeyAnswer =
  | Exclude<PlayerAnswer, { type: typeof PLAYER_ANSWERS.host }>
  | { type: typeof KEY_ANSWERS.skip; direction: SkipStep['direction'] }
  | { type: typeof KEY_ANSWERS.subtitle; key: string }
  | { type: typeof KEY_ANSWERS.leave }

/** The subtitle picker as the keys see it: each option's key and the one picked. */
type SubtitleChoice = {
  options: ReadonlyArray<{ key: string }>
  value: string
}

type KeyAnswerOfProps = {
  press: KeyPress
  /** Where the video is, in seconds. */
  position: number
  /** How long it is, in seconds; null until known. */
  duration: number | null
  volume: number
  isMuted: boolean
  /** Null while the video offers no subtitles to pick. */
  subtitles: SubtitleChoice | null
}

type ActionAnswerOfProps = Pick<
  KeyAnswerOfProps,
  'position' | 'duration' | 'volume' | 'isMuted' | 'subtitles'
> & {
  /** Every action but a skip, which the chrome's one skip ladder answers. */
  action: Exclude<PlayerAction, { type: typeof PLAYER_ACTIONS.skip }>
}

/** Subtitles go off when any are on, and otherwise the first the picker offers goes on. */
const subtitleToggleOf = (subtitles: SubtitleChoice | null): KeyAnswer | null => {
  if (subtitles === null) return null
  const off = SUBTITLE_CHOICES.off
  if (subtitles.value !== off) return { type: KEY_ANSWERS.subtitle, key: off }
  const first = subtitles.options.find((option) => option.key !== off) ?? null
  return first === null ? null : { type: KEY_ANSWERS.subtitle, key: first.key }
}

type HostAnswerOfProps = {
  action: HostAction
  subtitles: SubtitleChoice | null
}

/** The chrome's answer to an action core hands back to its host: subtitles and Escape only. */
const hostAnswerOf = ({ action, subtitles }: HostAnswerOfProps): KeyAnswer | null => {
  switch (action.type) {
    case PLAYER_ACTIONS.toggleSubtitles:
      return subtitleToggleOf(subtitles)
    case PLAYER_ACTIONS.escape:
      return { type: KEY_ANSWERS.leave }
    case PLAYER_ACTIONS.toggleFullscreen:
    case PLAYER_ACTIONS.stepFrame:
    case PLAYER_ACTIONS.stepSpeed:
    case PLAYER_ACTIONS.stepCaptionSize:
    case PLAYER_ACTIONS.toggleStats:
    case PLAYER_ACTIONS.showShortcuts:
      return null
    default: {
      const unknown: never = action
      return unknown
    }
  }
}

/** The chrome's answer to every action but a skip: core's shared answers, then the host's. */
const actionAnswerOf = ({ action, subtitles, ...state }: ActionAnswerOfProps): KeyAnswer | null => {
  // A skip never reaches here, so the skip ladder core keeps is never read.
  const { answer } = resolvePlayerAction({ action, state: { ...state, lastSkip: null, now: 0 } })
  if (answer === null) return null
  if (answer.type !== PLAYER_ANSWERS.host) return answer
  return hostAnswerOf({ action: answer.action, subtitles })
}

/**
 * The web player's answer to a key, as the touch chrome can give it: play or pause, a skip
 * either way (how far is the chrome's skip ladder's to say, since the buttons and the double
 * taps climb it too), a tenth of the video, the start or the end, the volume by the web's step,
 * mute, subtitles on or off, and Escape to leave. Full screen, frame steps, speeds, caption
 * sizes, the stats and the shortcut list are the web's alone: iOS plays full screen, and the
 * chrome offers none of the rest.
 */
export const keyAnswerOf = ({ press, ...playing }: KeyAnswerOfProps): KeyAnswer | null => {
  const action = shortcutFor(press)
  if (action === null) return null
  if (action.type === PLAYER_ACTIONS.skip) {
    return { type: KEY_ANSWERS.skip, direction: action.direction }
  }
  return actionAnswerOf({ ...playing, action })
}
