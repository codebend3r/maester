import type { MediaItem } from '@raven/core'
import { create } from 'zustand'

type VideoQueue = {
  /** The videos a library's Shuffle dealt, in the order they play. */
  items: readonly MediaItem[]
  start: (items: readonly MediaItem[]) => void
}

/**
 * A library's shuffle, kept for the run: the player in the `queue` session plays it through, its
 * Next the video after the one playing and its back the one before, so going forward and back
 * never loses the deal. A new Shuffle deals again.
 */
export const useVideoQueue = create<VideoQueue>()((set) => ({
  items: [],
  start: (items) => set({ items }),
}))

type QueueNeighbourProps = { items: readonly MediaItem[]; mediaId: number; step: -1 | 1 }

/** The video beside `mediaId` in the queue, `step` along it; null at either end or off it. */
export const queueNeighbourOf = ({
  items,
  mediaId,
  step,
}: QueueNeighbourProps): MediaItem | null => {
  const place = items.findIndex((item) => item.id === mediaId)
  return place < 0 ? null : (items[place + step] ?? null)
}
