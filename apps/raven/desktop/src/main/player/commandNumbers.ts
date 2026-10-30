import { PLAYER_COMMANDS, type PlayerCommand } from '@raven/core'

type ClampProps = { value: number; min: number; max: number }

export const clamp = ({ value, min, max }: ClampProps): number =>
  Math.min(max, Math.max(min, value))

/** How slow and how fast mpv may play, a video or a track. */
export const SPEED_RANGE = { min: 0.25, max: 4 } as const

/** The numbers a command carries, which must be finite before any of them is used. */
export const numbersOf = (command: PlayerCommand): number[] => {
  switch (command.type) {
    case PLAYER_COMMANDS.load:
      return [command.start, ...(command.audio === null ? [] : [command.audio])]
    case PLAYER_COMMANDS.seek:
      return [command.time]
    case PLAYER_COMMANDS.audio:
      return command.index === null ? [] : [command.index]
    case PLAYER_COMMANDS.volume:
      return [command.volume]
    case PLAYER_COMMANDS.speed:
      return [command.rate]
    case PLAYER_COMMANDS.subtitleScale:
      return [command.scale]
    case PLAYER_COMMANDS.play:
    case PLAYER_COMMANDS.pause:
    case PLAYER_COMMANDS.subtitle:
    case PLAYER_COMMANDS.stats:
    case PLAYER_COMMANDS.stop:
      return []
    default: {
      const unreachable: never = command
      return unreachable
    }
  }
}
