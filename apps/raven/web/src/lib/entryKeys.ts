import type { ItemSummary, MediaItem } from '@raven/core'

/** How a card names its entry for the jump strip, as `data-entry`. */
export const mediaEntryKey = (media: MediaItem): string => `media:${media.id}`
export const showEntryKey = (show: ItemSummary): string => `show:${show.id}`
