import type { Timers } from '@/main/timers'

type CreateStallBudgetProps = {
  timers: Timers
  ms: number
  /** The service's epoch, so a budget armed for one step lapses once another overtook it. */
  epoch: () => number
  /** Whether the server owes the title something, which is all the budget runs for. */
  isOwed: () => boolean
  /** The budget ran out with the server still owing the title. */
  onStalled: () => void
}

export type StallBudget = {
  /** Starts the budget over while the server owes the title something; clears it otherwise. */
  restart: () => void
  /** Starts the budget over only while it runs: the clock moved, or bytes came. */
  touch: () => void
  clear: () => void
}

/**
 * How long a server title may wait on its server without the clock moving or bytes arriving:
 * lavf's own timeouts and reconnects would let a server that accepts and then sends nothing
 * hold the page for about two minutes.
 */
export const createStallBudget = ({
  timers,
  ms,
  epoch,
  isOwed,
  onStalled,
}: CreateStallBudgetProps): StallBudget => {
  let handle: unknown = null

  const clear = (): void => {
    if (handle !== null) timers.clear(handle)
    handle = null
  }

  const restart = (): void => {
    clear()
    if (!isOwed()) return
    const token = epoch()
    handle = timers.set({
      run: () => {
        handle = null
        if (token !== epoch() || !isOwed()) return
        onStalled()
      },
      ms,
    })
  }

  return {
    restart,
    touch: () => {
      if (handle !== null) restart()
    },
    clear,
  }
}
