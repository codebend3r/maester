import { BOUNDED_OUTCOMES, within } from '@/main/bounded'
import type { MpvControl } from '@/main/player/guardedMpv'
import { type LoadTarget, type Sidecar, subAddArgs } from '@/main/player/loadTarget'
import type { Timers } from '@/main/stateStore'
import { messageOf } from '@/shared/messageOf'

/** How long a server title's first snapshot waits for its sidecars before it goes on. */
export const SIDECAR_BUDGET_MS = 3000

type CreateSidecarAdderProps = {
  mpv: Pick<MpvControl, 'command'>
  timers: Timers
  warn: (message: string) => void
  /** Whether the load that began with `token` is still the newest. */
  isCurrent: (token: number) => boolean
}

type AddSidecarsProps = {
  sidecars: readonly Sidecar[]
  kind: LoadTarget['kind']
  token: number
}

/** What waiting for a title's sidecars came to. */
export type SidecarsAdded = {
  /** False when the load was overtaken while they went in. */
  isCurrent: boolean
  /** The chain still adding them when it outlasted the budget, else null. */
  pending: Promise<boolean> | null
}

/** Adds a title's sidecars to mpv, one at a time and in order, inside the snapshot's budget. */
export const createSidecarAdder = ({ mpv, timers, warn, isCurrent }: CreateSidecarAdderProps) => {
  /** Adds the sidecars in order; false when overtaken. */
  const addEach = ({ sidecars, token }: Pick<AddSidecarsProps, 'sidecars' | 'token'>) =>
    sidecars.reduce<Promise<boolean>>(async (chain, sidecar, position) => {
      if (!(await chain)) return false
      try {
        await mpv.command({ args: subAddArgs(sidecar) })
      } catch (error) {
        warn(`mpv sub-add of sidecar ${position} failed: ${messageOf(error)}`)
      }
      return isCurrent(token)
    }, Promise.resolve(true))

  /**
   * Waits for a title's sidecars, but no longer than `SIDECAR_BUDGET_MS`: a slow server or
   * disk must not hold the first events back. Late sidecars still go in, in order, and reach
   * the page through `track-list`.
   */
  const addWithinBudget = async ({
    sidecars,
    kind,
    token,
  }: AddSidecarsProps): Promise<SidecarsAdded> => {
    const adding = addEach({ sidecars, token })
    const bounded = await within({ task: adding, ms: SIDECAR_BUDGET_MS, timers })
    switch (bounded.outcome) {
      case BOUNDED_OUTCOMES.answered:
        return { isCurrent: bounded.result && isCurrent(token), pending: null }
      case BOUNDED_OUTCOMES.late:
        warn(`${kind} sidecars are slow; the title starts without them`)
        return { isCurrent: isCurrent(token), pending: adding }
      case BOUNDED_OUTCOMES.failed:
        throw bounded.error
      default: {
        const unreachable: never = bounded
        return unreachable
      }
    }
  }

  return { addWithinBudget }
}
