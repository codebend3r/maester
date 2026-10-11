import type { ItemSummary, MediaItem } from '@raven/core'

/** Where an item's page lives, or null for one that has no page of its own. */
export const itemPath = (item: ItemSummary): string | null => {
  if (item.type === 'movie') return `/movies/${item.id}`
  if (item.type === 'show') return `/shows/${item.id}`
  if (item.type === 'episode') return `/episodes/${item.id}`
  return item.show && item.season != null ? `/shows/${item.show.id}/seasons/${item.season}` : null
}

/** Where a card goes: a matched item's page, or straight to the player for anything else. */
export const openPath = (media: MediaItem): string => {
  const page = media.item ? itemPath(media.item) : null
  return page ?? `/watch/${media.id}`
}

/** "2011 to 2019", "2022 to now", or just the year for a show that began and ended in one. */
export const showYears = ({
  year,
  endedYear,
}: {
  year: number | null
  endedYear: number | null
}): string | null => {
  if (year == null) return null
  if (endedYear == null) return `${year} to now`
  return endedYear === year ? String(year) : `${year} to ${endedYear}`
}
