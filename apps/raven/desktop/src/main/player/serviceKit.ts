import { isNumber } from '@raven/core'
import { MPV_COMMANDS, MPV_OPTIONS, type MpvOption } from '@raven/mpv'
import { clamp } from '@/main/player/commandNumbers'
import type { MpvControl } from '@/main/player/guardedMpv'
import { ENGINE_GONE, type PlayerOutcome, refuse } from '@/main/player/outcomes'
import { PLAYER_MESSAGES } from '@/main/player/playerMessages'
import { messageOf } from '@/shared/messageOf'

/*
 * What the video and the music services share. Both run their reports inside the wrapper's event
 * drain, so nothing a report throws may escape: each is warned instead.
 */

type Warn = (message: string) => void

type ReportingProps<A extends unknown[]> = {
  report: (...input: A) => void
  warn: Warn
  /** What the report is, for the warning a throw from it becomes. */
  what: string
}

/** `report`, warned rather than thrown when it fails. */
export const reporting =
  <A extends unknown[]>({ report, warn, what }: ReportingProps<A>) =>
  (...input: A): void => {
    try {
      report(...input)
    } catch (error) {
      warn(`${what} failed: ${messageOf(error)}`)
    }
  }

type CreateListenersProps = { warn: Warn; what: string }

/** The page's listeners, each heard in turn, so one that throws costs only a warning. */
export type Listeners<E> = {
  emit: (event: E) => void
  subscribe: (listener: (event: E) => void) => () => void
}

export const createListeners = <E>({ warn, what }: CreateListenersProps): Listeners<E> => {
  const listeners = new Set<(event: E) => void>()
  const safely = (event: E) => (listener: (event: E) => void) =>
    reporting<[E]>({ report: listener, warn, what })(event)
  return {
    emit: (event) => {
      Array.from(listeners).forEach(safely(event))
    },
    subscribe: (listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
}

type CreateCommandHandlerProps<C> = {
  isDead: () => boolean
  /** The numbers a command carries, which must all be finite before it runs. */
  numbersOf: (command: C) => number[]
  run: (command: C) => Promise<PlayerOutcome>
  warn: Warn
}

/**
 * Answers every command once: a dead engine is gone, a command with a number that is not one is
 * refused, and a failure is warned and refused, or gone when mpv stopped meanwhile.
 */
export const createCommandHandler =
  <C extends { type: string }>({ isDead, numbersOf, run, warn }: CreateCommandHandlerProps<C>) =>
  async (command: C): Promise<PlayerOutcome> => {
    if (isDead()) return ENGINE_GONE
    if (!numbersOf(command).every(isNumber)) return refuse(PLAYER_MESSAGES.failed)
    try {
      return await run(command)
    } catch (error) {
      warn(`mpv ${command.type} failed: ${messageOf(error)}`)
      // The wrapper rejects what is in flight just before it reports a shutdown.
      return isDead() ? ENGINE_GONE : refuse(PLAYER_MESSAGES.failed)
    }
  }

type SetVolumeProps = { mpv: MpvControl; volume: number; isMuted: boolean }

/** The page's volume, 0 to 1, as mpv's 0 to 100, then whether it is muted. */
export const setVolume = async ({ mpv, volume, isMuted }: SetVolumeProps): Promise<void> => {
  const level = clamp({ value: volume, min: 0, max: 1 })
  await mpv.set({ name: MPV_OPTIONS.volume, value: Math.round(level * 1000) / 10 })
  await mpv.set({ name: MPV_OPTIONS.mute, value: isMuted })
}

type ApplyOptionsProps = {
  mpv: MpvControl
  setEach: (options: readonly MpvOption[]) => Promise<void>
  options: readonly MpvOption[]
  /**
   * Whether a file is open, which must reopen its audio output to hear the change; asked once
   * the options are set, since a file may load or stop meanwhile.
   */
  isLoaded: () => boolean
  warn: Warn
}

/** The output settings applied, and the open file's audio output reopened on them. */
export const applyOutputOptions = async ({
  mpv,
  setEach,
  options,
  isLoaded,
  warn,
}: ApplyOptionsProps): Promise<void> => {
  await setEach(options)
  if (!isLoaded()) return
  try {
    await mpv.command({ args: [MPV_COMMANDS.aoReload] })
  } catch (error) {
    warn(`mpv ao-reload failed: ${messageOf(error)}`)
  }
}
