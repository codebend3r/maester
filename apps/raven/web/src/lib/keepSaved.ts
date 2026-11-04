import type { Query, QueryClient } from '@tanstack/react-query'

/** How long after a saved query changes before the device's copy is brought up to date, so a burst of reads writes once. */
const SAVE_DELAY_MS = 5_000

const keepers = new Set<() => void>()

type KeepSavedProps = {
  queryClient: QueryClient
  /** Whether a query that was just read is one this save keeps. */
  isSaved: (query: Query) => boolean
  save: () => Promise<void>
}

/**
 * Runs `save` a few seconds after a query `isSaved` picks is read, at most
 * once in that time. Returns what stops it.
 */
export const keepSaved = ({ queryClient, isSaved, save }: KeepSavedProps): (() => void) => {
  let timer: ReturnType<typeof setTimeout> | null = null
  const unsubscribe = queryClient.getQueryCache().subscribe((event) => {
    if (event.type !== 'updated' || event.action.type !== 'success') return
    if (!isSaved(event.query) || timer !== null) return
    timer = setTimeout(() => {
      timer = null
      save().catch((error) => console.error(error))
    }, SAVE_DELAY_MS)
  })
  const stop = () => {
    keepers.delete(stop)
    unsubscribe()
    if (timer !== null) clearTimeout(timer)
    timer = null
  }
  keepers.add(stop)
  return stop
}

/**
 * Stops every save in waiting, so what is read after the account changes is
 * never kept under the one that left. Whatever is still showing starts again
 * with its next change.
 */
export const stopKeepingSaved = (): void => [...keepers].forEach((stop) => stop())
