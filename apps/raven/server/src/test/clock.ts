import type { Clock } from '@/clock'

/** A clock that moves only when the test says, firing what falls due. */
export const manualClock = () => {
  const state = { now: 0, timers: new Set<{ at: number; run: () => void }>() }
  const clock: Clock = {
    now: () => state.now,
    after: ({ ms, run: fire }) => {
      const timer = { at: state.now + ms, run: fire }
      state.timers.add(timer)
      return () => {
        state.timers.delete(timer)
      }
    },
  }
  const advance = (ms: number): void => {
    state.now += ms
    const due = [...state.timers].filter((timer) => timer.at <= state.now)
    due.forEach((timer) => {
      state.timers.delete(timer)
      timer.run()
    })
  }
  return { clock, advance, pending: () => state.timers.size }
}

/** The real time with timers that never fire, so only what a test drives ends anything. */
export const STILL_CLOCK: Clock = { now: () => Date.now(), after: () => () => undefined }
