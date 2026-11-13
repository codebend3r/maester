type SetProps = { run: () => void; ms: number }

/** The timers every part of main is handed, so a test can run them by hand. */
export type Timers = {
  set: (input: SetProps) => unknown
  clear: (handle: unknown) => void
}

/** Node runs a longer delay at once, so no timer is ever armed for more. */
export const TIMER_MAX_MS = 2 ** 31 - 1

/**
 * Node's timers behind the `Timers` seam. Handles are plain numbers kept in a map,
 * so `clear` can narrow what it is given instead of trusting it is a `Timeout`.
 */
export const createNodeTimers = (): Timers => {
  const live = new Map<number, ReturnType<typeof setTimeout>>()
  let next = 0

  return {
    set: ({ run, ms }) => {
      next += 1
      const handle = next
      live.set(
        handle,
        setTimeout(() => {
          live.delete(handle)
          run()
        }, ms),
      )
      return handle
    },
    clear: (handle) => {
      if (typeof handle !== 'number') return
      clearTimeout(live.get(handle))
      live.delete(handle)
    },
  }
}
