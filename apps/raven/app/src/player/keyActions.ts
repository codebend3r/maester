import {
  KEYS,
  type KeyPress,
  PLAYER_ACTIONS,
  type PlayerAction,
  SEEK_EDGES,
  type SkipStep,
  shortcutFor,
  stepSkip,
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
  seek: 'seek',
  togglePlay: 'togglePlay',
  volume: 'volume',
  subtitle: 'subtitle',
  leave: 'leave',
} as const

/** What the touch chrome does for a key: the same as the button for it would. */
export type KeyAnswer =
  | { type: typeof KEY_ANSWERS.seek; to: number }
  | { type: typeof KEY_ANSWERS.togglePlay }
  | { type: typeof KEY_ANSWERS.volume; volume: number; isMuted: boolean }
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
  /** The last skip a key made, for the quick presses that go further. */
  lastSkip: SkipStep | null
  /** The clock the skips count by, in milliseconds. */
  now: number
}

type KeyAnswered = { answer: KeyAnswer | null; lastSkip: SkipStep | null }

type ActionAnswerOfProps = Pick<
  KeyAnswerOfProps,
  'position' | 'duration' | 'volume' | 'isMuted' | 'subtitles'
> & {
  /** Every action but a skip, which counts the presses before it and is answered on its own. */
  action: Exclude<PlayerAction, { type: typeof PLAYER_ACTIONS.skip }>
}

const clampVolume = (value: number): number => Math.min(1, Math.max(0, value))

/** Subtitles go off when any are on, and otherwise the first the picker offers goes on. */
const subtitleToggleOf = (subtitles: SubtitleChoice | null): KeyAnswer | null => {
  if (subtitles === null) return null
  const off = SUBTITLE_CHOICES.off
  if (subtitles.value !== off) return { type: KEY_ANSWERS.subtitle, key: off }
  const first = subtitles.options.find((option) => option.key !== off) ?? null
  return first === null ? null : { type: KEY_ANSWERS.subtitle, key: first.key }
}

/** The chrome's answer to an action that leaves the skips' count as it was. */
const actionAnswerOf = ({
  action,
  position,
  duration,
  volume,
  isMuted,
  subtitles,
}: ActionAnswerOfProps): KeyAnswer | null => {
  switch (action.type) {
    case PLAYER_ACTIONS.togglePlay:
      return { type: KEY_ANSWERS.togglePlay }
    case PLAYER_ACTIONS.seekToFraction:
      return duration === null ? null : { type: KEY_ANSWERS.seek, to: duration * action.fraction }
    case PLAYER_ACTIONS.seekToEdge:
      return {
        type: KEY_ANSWERS.seek,
        to: action.edge === SEEK_EDGES.start ? 0 : (duration ?? position),
      }
    case PLAYER_ACTIONS.volumeBy: {
      const next = clampVolume((isMuted ? 0 : volume) + action.delta)
      return { type: KEY_ANSWERS.volume, volume: next, isMuted: next === 0 }
    }
    case PLAYER_ACTIONS.toggleMute:
      return { type: KEY_ANSWERS.volume, volume, isMuted: !isMuted }
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

/**
 * The web player's answer to a key, as the touch chrome can give it: play or pause, the skips
 * (10 seconds, further when pressed quickly, as core's `stepSkip` counts them), a tenth of the
 * video, the start or the end, the volume by the web's step, mute, subtitles on or off, and
 * Escape to leave. Full screen, frame steps, speeds, caption sizes, the stats and the shortcut
 * list are the web's alone: iOS plays full screen, and the chrome offers none of the rest.
 */
export const keyAnswerOf = ({
  press,
  lastSkip,
  now,
  ...playing
}: KeyAnswerOfProps): KeyAnswered => {
  const action = shortcutFor(press)
  if (action === null) return { answer: null, lastSkip }
  if (action.type !== PLAYER_ACTIONS.skip) {
    return { answer: actionAnswerOf({ ...playing, action }), lastSkip }
  }
  const step = stepSkip({ last: lastSkip, direction: action.direction, at: now })
  return {
    answer: { type: KEY_ANSWERS.seek, to: playing.position + step.seconds * step.direction },
    lastSkip: step,
  }
}
