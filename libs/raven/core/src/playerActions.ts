import { PLAYER_ACTIONS, type PlayerAction, SEEK_EDGES, type SkipStep, stepSkip } from '@/shortcuts'

/** What every player does the same way in answer to an action, or hands back to its host. */
export const PLAYER_ANSWERS = {
  togglePlay: 'togglePlay',
  seek: 'seek',
  volume: 'volume',
  host: 'host',
} as const

/** The actions whose answer every player gives alike. */
type SharedActionType =
  | typeof PLAYER_ACTIONS.togglePlay
  | typeof PLAYER_ACTIONS.skip
  | typeof PLAYER_ACTIONS.seekToFraction
  | typeof PLAYER_ACTIONS.seekToEdge
  | typeof PLAYER_ACTIONS.volumeBy
  | typeof PLAYER_ACTIONS.toggleMute

/** An action only the host can carry out: its full screen, menus, subtitles and the rest. */
export type HostAction = Exclude<PlayerAction, { type: SharedActionType }>

export type PlayerAnswer =
  | { type: typeof PLAYER_ANSWERS.togglePlay }
  | { type: typeof PLAYER_ANSWERS.seek; to: number }
  | { type: typeof PLAYER_ANSWERS.volume; volume: number; isMuted: boolean }
  | { type: typeof PLAYER_ANSWERS.host; action: HostAction }

/** What an action is answered from. */
export type PlayerActionState = {
  /** Where the video is, in seconds. */
  position: number
  /** How long it is, in seconds; null until known. */
  duration: number | null
  volume: number
  isMuted: boolean
  /** The last skip, for the quick presses that go further. */
  lastSkip: SkipStep | null
  /** The clock the skips count by, in milliseconds. */
  now: number
}

/** The answer to an action, null for one there is nothing to do for, and the skip it made. */
export type ResolvedAction = { answer: PlayerAnswer | null; lastSkip: SkipStep | null }

/** `value` within 0 and 1, as a player's volume is. */
export const playerVolumeOf = (value: number): number => Math.min(1, Math.max(0, value))

type ResolvePlayerActionProps = {
  action: PlayerAction
  state: PlayerActionState
}

/**
 * What a player does for `action`: play or pause, where to seek (a skip counts the quick
 * presses before it, as `stepSkip` does; a fraction waits for the duration), the volume and
 * mute, or the action itself for the host to carry out.
 */
export const resolvePlayerAction = ({
  action,
  state,
}: ResolvePlayerActionProps): ResolvedAction => {
  const { position, duration, volume, isMuted, lastSkip, now } = state
  const answered = (answer: PlayerAnswer | null): ResolvedAction => ({ answer, lastSkip })
  switch (action.type) {
    case PLAYER_ACTIONS.togglePlay:
      return answered({ type: PLAYER_ANSWERS.togglePlay })
    case PLAYER_ACTIONS.skip: {
      const step = stepSkip({ last: lastSkip, direction: action.direction, at: now })
      return {
        answer: { type: PLAYER_ANSWERS.seek, to: position + step.seconds * step.direction },
        lastSkip: step,
      }
    }
    case PLAYER_ACTIONS.seekToFraction:
      return answered(
        duration === null ? null : { type: PLAYER_ANSWERS.seek, to: duration * action.fraction },
      )
    case PLAYER_ACTIONS.seekToEdge:
      return answered({
        type: PLAYER_ANSWERS.seek,
        to: action.edge === SEEK_EDGES.start ? 0 : (duration ?? position),
      })
    case PLAYER_ACTIONS.volumeBy: {
      const next = playerVolumeOf((isMuted ? 0 : volume) + action.delta)
      return answered({ type: PLAYER_ANSWERS.volume, volume: next, isMuted: next === 0 })
    }
    case PLAYER_ACTIONS.toggleMute:
      return answered({ type: PLAYER_ANSWERS.volume, volume, isMuted: !isMuted })
    default:
      return answered({ type: PLAYER_ANSWERS.host, action })
  }
}
