import { type MediaItem, cardLink } from '@raven/core'
import { itemQuery } from '@/lib/queries'
import { queryClient } from '@/lib/queryClient'

/** How long the pointer rests on a card before its page's data is asked for, so a sweep across a grid asks for none. */
const REST_MS = 120

/** How long a prefetched page stays good enough not to be asked for again on the next pass. */
const FRESH_MS = 30_000

// One pointer, so one wait at a time: entering the next card replaces it.
const pending: { timer: ReturnType<typeof setTimeout> | null } = { timer: null }

const cancel = (): void => {
  if (pending.timer) clearTimeout(pending.timer)
  pending.timer = null
}

const prefetch = (id: number): void => {
  // prefetchQuery settles even when the call fails; the page asks again itself.
  queryClient.prefetchQuery({ ...itemQuery(id), staleTime: FRESH_MS }).catch(() => undefined)
}

/** The item whose page a video's card opens, as `cardLink` links it; null for one that opens the player. */
export const pageItemOf = (media: MediaItem): number | null =>
  cardLink({ media, hasPages: true }).state == null ? (media.item?.id ?? null) : null

/**
 * Handlers for a card link to item `id`'s page that read the page's data
 * while the pointer rests on it or it takes focus, so the page draws at once
 * when it opens and its pictures are asked for a round trip sooner. No hooks
 * and one shared timer: a grid holds thousands of these links.
 */
export const prefetchItemHandlers = (id: number | null | undefined) => {
  if (id == null) return {}
  return {
    onPointerEnter: () => {
      cancel()
      pending.timer = setTimeout(() => {
        pending.timer = null
        prefetch(id)
      }, REST_MS)
    },
    onPointerLeave: cancel,
    onFocus: () => {
      cancel()
      prefetch(id)
    },
  }
}
