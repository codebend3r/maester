type AfterProps = { ms: number; run: () => void }

/** The clock and timers the HLS sessions and the account passes run on; a test moves them by hand. */
export type Clock = {
  now: () => number
  /** Calls `run` after `ms`; what it returns cancels that. */
  after: ({ ms, run }: AfterProps) => () => void
}

/** The DI token the server's clock is provided under. */
export const CLOCK = Symbol('CLOCK')

export const SYSTEM_CLOCK: Clock = {
  now: () => Date.now(),
  after: ({ ms, run }) => {
    const timer = setTimeout(run, ms)
    // A session's or a pass's timer alone never keeps the process alive.
    timer.unref()
    return () => clearTimeout(timer)
  },
}

/** The calendar day `at` falls on, in UTC, as `YYYY-MM-DD`: the same for every viewer and every server zone. */
export const utcDayOf = (at: number): string => new Date(at).toISOString().slice(0, 10)
