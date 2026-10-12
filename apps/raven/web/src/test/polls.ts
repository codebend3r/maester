import { timeoutManager } from '@tanstack/react-query'

/** How many times sooner a query's poll comes round: once, but in a test that waits on one. */
const pace = { speedUp: 1 }

/**
 * Hands TanStack Query timers that run as the platform's do, but for a
 * query's poll, which comes round at the pace the test sets. TanStack keeps
 * its own timers to itself, so they are written out again here. Called
 * before any query client exists, as TanStack asks.
 */
export const pacePolls = (): void =>
  timeoutManager.setTimeoutProvider({
    setTimeout: (callback, delay) => setTimeout(callback, delay),
    clearTimeout: (id) => clearTimeout(id),
    setInterval: (callback, delay) => setInterval(callback, delay / pace.speedUp),
    clearInterval: (id) => clearInterval(id),
  })

/** Has this test's polls come round a hundred times sooner, so waiting on one takes milliseconds. */
export const pollFast = (): void => {
  pace.speedUp = 100
}

/** Puts polls back at their own pace, after each test. */
export const resetPolls = (): void => {
  pace.speedUp = 1
}
