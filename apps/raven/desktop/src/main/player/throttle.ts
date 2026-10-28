import type { Timers } from '@/main/stateStore'

type CreateThrottleProps<T> = {
  timers: Timers
  /** The quiet period after a value is shown, during which the newest value is held instead. */
  ms: number
  /** Shows a value; false when it showed nothing, so no quiet period starts. */
  show: (value: T) => boolean
}

export type Throttle<T> = {
  /** Shows the value now, or holds it until the quiet period ends and the newest held value is shown. */
  push: (value: T) => void
  /** Drops what is held; a quiet period under way still runs out. */
  drop: () => void
  /** Drops what is held and ends the quiet period, so the next push shows at once. */
  clear: () => void
}

/**
 * A trailing throttle: the first value shows at once, the ones that follow within `ms` are
 * held and the newest of them shows when the period ends, which starts another period.
 */
export const createThrottle = <T>({ timers, ms, show }: CreateThrottleProps<T>): Throttle<T> => {
  let timer: unknown = null
  let held: { value: T } | null = null

  const push = (value: T): void => {
    if (timer !== null) {
      held = { value }
      return
    }
    if (!show(value)) return
    timer = timers.set({
      run: () => {
        timer = null
        const next = held
        held = null
        if (next !== null) push(next.value)
      },
      ms,
    })
  }

  const drop = (): void => {
    held = null
  }

  return {
    push,
    drop,
    clear: () => {
      if (timer !== null) timers.clear(timer)
      timer = null
      drop()
    },
  }
}
