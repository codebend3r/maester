import { PLAYER_COMMANDS, type PlayerCommand } from '@raven/core'
import { MPV_COMMANDS, MPV_PROPERTIES, MPV_SCRIPT_BINDINGS } from '@raven/mpv'
import { SPEED_RANGE, clamp } from '@/main/player/commandNumbers'
import type { MpvControl } from '@/main/player/guardedMpv'
import { OK, type PlayerOutcome } from '@/main/player/outcomes'
import { setVolume } from '@/main/player/serviceKit'
import { subtitleStyleOptions } from '@/main/player/subtitleLook'

/** A command of one type. */
export type CommandOf<T extends PlayerCommand['type']> = Extract<PlayerCommand, { type: T }>

type CreateCommandRouterProps = {
  mpv: MpvControl
  /** Whether the output carries the stream as it is, so its volume stays where it is. */
  isVolumeFixed: () => boolean
  load: (command: CommandOf<typeof PLAYER_COMMANDS.load>) => Promise<PlayerOutcome>
  seek: (time: number) => Promise<PlayerOutcome>
  audio: (index: number | null) => Promise<PlayerOutcome>
  subtitle: (id: string | null) => Promise<PlayerOutcome>
  stop: () => Promise<PlayerOutcome>
}

/** Each command to what does it: the title's own steps to the service, the rest straight to mpv. */
export const createCommandRouter =
  ({ mpv, isVolumeFixed, load, seek, audio, subtitle, stop }: CreateCommandRouterProps) =>
  async (command: PlayerCommand): Promise<PlayerOutcome> => {
    switch (command.type) {
      case PLAYER_COMMANDS.load:
        return load(command)
      case PLAYER_COMMANDS.play:
        await mpv.set({ name: MPV_PROPERTIES.pause, value: false })
        return OK
      case PLAYER_COMMANDS.pause:
        await mpv.set({ name: MPV_PROPERTIES.pause, value: true })
        return OK
      case PLAYER_COMMANDS.seek:
        return seek(command.time)
      case PLAYER_COMMANDS.audio:
        return audio(command.index)
      case PLAYER_COMMANDS.subtitle:
        return subtitle(command.id)
      case PLAYER_COMMANDS.volume:
        if (isVolumeFixed()) return OK
        await setVolume({ mpv, volume: command.volume, isMuted: command.muted })
        return OK
      case PLAYER_COMMANDS.speed:
        await mpv.set({
          name: MPV_PROPERTIES.speed,
          value: clamp({ value: command.rate, min: SPEED_RANGE.min, max: SPEED_RANGE.max }),
        })
        return OK
      case PLAYER_COMMANDS.subtitleStyle:
        await Promise.all(subtitleStyleOptions(command.style).map((option) => mpv.set(option)))
        return OK
      case PLAYER_COMMANDS.stats:
        await mpv.command({ args: [MPV_COMMANDS.scriptBinding, MPV_SCRIPT_BINDINGS.statsToggle] })
        return OK
      case PLAYER_COMMANDS.stop:
        return stop()
      default: {
        const unreachable: never = command
        return unreachable
      }
    }
  }
