import type { MpvProperty, MpvPropertyValue } from '@raven/mpv'
import type { MpvControl } from '@/main/player/guardedMpv'
import type { MpvOption } from '@/main/player/outputOptions'
import { messageOf } from '@/shared/messageOf'

type CreateQuietMpvProps = {
  mpv: MpvControl
  warn: (message: string) => void
}

type ReadOrProps<K extends MpvProperty> = {
  name: K
  fallback: MpvPropertyValue<K>
}

/** The mpv calls the service makes without caring for the answer: a failure is warned, never thrown. */
export const createQuietMpv = ({ mpv, warn }: CreateQuietMpvProps) => {
  const set = async ({ name, value }: MpvOption): Promise<void> => {
    try {
      await mpv.set({ name, value })
    } catch (error) {
      warn(`mpv set ${name} failed: ${messageOf(error)}`)
    }
  }

  const setEach = (options: readonly MpvOption[]): Promise<void> =>
    options.reduce<Promise<void>>(
      (chain, option) => chain.then(() => set(option)),
      Promise.resolve(),
    )

  const readOr = async <K extends MpvProperty>({
    name,
    fallback,
  }: ReadOrProps<K>): Promise<MpvPropertyValue<K>> => {
    try {
      return await mpv.read({ name })
    } catch (error) {
      warn(`mpv read ${name} failed: ${messageOf(error)}`)
      return fallback
    }
  }

  /** Sets each option in turn and fails closed: false at the first set mpv refuses. */
  const harden = async (options: readonly MpvOption[]): Promise<boolean> => {
    const [first, ...rest] = options
    if (first === undefined) return true
    try {
      await mpv.set(first)
    } catch (error) {
      warn(`mpv set ${first.name} failed: ${messageOf(error)}`)
      return false
    }
    return harden(rest)
  }

  return { set, setEach, readOr, harden }
}
