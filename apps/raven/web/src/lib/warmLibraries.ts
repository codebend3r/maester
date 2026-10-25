import type { QueryClient } from '@tanstack/react-query'
import { type ListedLibrary, isCacheable, prefetchListing } from '@/lib/libraryListing'

/** The breather between one library and the next, so reading them all never crowds out what the person is doing. */
const GAP_MS = 1_500

/** How long the browser may stay busy before a library is read anyway. */
const IDLE_TIMEOUT_MS = 10_000

const pause = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

const idle = (): Promise<void> =>
  new Promise((resolve) => {
    if (typeof requestIdleCallback !== 'function') {
      resolve()
      return
    }
    requestIdleCallback(() => resolve(), { timeout: IDLE_TIMEOUT_MS })
  })

const visible = (): Promise<void> =>
  document.hidden
    ? new Promise((resolve) =>
        document.addEventListener('visibilitychange', () => resolve(), { once: true }),
      )
    : Promise.resolve()

/** Resolves once the tab is showing and the browser has nothing better to do. */
const untilIdle = async (): Promise<void> => {
  await visible()
  await pause(GAP_MS)
  await idle()
}

/**
 * Reads each cacheable library's listing into the cache, one after another,
 * each when the browser is idle, so opening a library later draws from the
 * cache. A listing that is still fresh is not asked for again, and a failed
 * read is left for the page to try. `signal` stops it between libraries.
 */
export const warmLibraries = ({
  queryClient,
  libraries,
  signal,
  wait = untilIdle,
}: {
  queryClient: QueryClient
  libraries: ListedLibrary[]
  signal: AbortSignal
  wait?: () => Promise<void>
}): Promise<void> =>
  libraries.filter(isCacheable).reduce(
    (previous, library) =>
      previous.then(async () => {
        if (signal.aborted) return
        await wait()
        if (signal.aborted) return
        await prefetchListing({ queryClient, library })
      }),
    Promise.resolve(),
  )
