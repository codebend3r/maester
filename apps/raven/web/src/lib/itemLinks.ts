import type { ItemSummary, MediaItem } from '@raven/core'

/** Where an item's page lives, or null for a type with no page yet. */
export const itemPath = (item: ItemSummary): string | null =>
  item.type === 'movie' ? `/movies/${item.id}` : null

/** Where a card goes: a matched movie's page, or straight to the player for anything else. */
export const openPath = (media: MediaItem): string => {
  const page = media.item ? itemPath(media.item) : null
  return page ?? `/watch/${media.id}`
}
