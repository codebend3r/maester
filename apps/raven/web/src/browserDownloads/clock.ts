type SleepProps = { ms: number; signal: AbortSignal }

type AfterProps = { ms: number; run: () => void }

type CallOff = () => void

/** The time, the waits and the timers the downloads take, so a test runs them without any. */
export type DownloadClock = {
  now: () => number
  /** Waits `ms`, or less when `signal` aborts; it never rejects, so the caller reads the signal. */
  sleep: (input: SleepProps) => Promise<void>
  /** Calls `run` once `ms` have passed; what it answers calls that off. */
  after: (input: AfterProps) => CallOff
}

/** The event a signal sends when it aborts. */
export const ABORT = 'abort'

export const browserClock: DownloadClock = {
  now: () => Date.now(),
  sleep: ({ ms, signal }) =>
    new Promise((resolve) => {
      if (signal.aborted) return resolve()
      const timer = setTimeout(resolve, ms)
      signal.addEventListener(
        ABORT,
        () => {
          clearTimeout(timer)
          resolve()
        },
        { once: true },
      )
    }),
  after: ({ ms, run }) => {
    const timer = setTimeout(run, ms)
    return () => clearTimeout(timer)
  },
}
