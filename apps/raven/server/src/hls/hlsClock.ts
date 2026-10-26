type AfterProps = { ms: number; run: () => void }

/** The clock and timers the HLS sessions run on; a test moves them by hand. */
export type HlsClock = {
  now: () => number
  /** Calls `run` after `ms`; what it returns cancels that. */
  after: ({ ms, run }: AfterProps) => () => void
}

/** The DI token the sessions' clock is provided under. */
export const HLS_CLOCK = Symbol('HLS_CLOCK')

export const SYSTEM_CLOCK: HlsClock = {
  now: () => Date.now(),
  after: ({ ms, run }) => {
    const timer = setTimeout(run, ms)
    // A session's timer alone never keeps the process alive.
    timer.unref()
    return () => clearTimeout(timer)
  },
}
