import type { ItemSummary, MediaItem } from '@raven/core'

/** A season's page, by its show and number. */
export const seasonPath = ({ showId, season }: { showId: number; season: number }): string =>
  `/shows/${showId}/seasons/${season}`

/** Where an item's page lives, or null for one that has no page of its own. */
export const itemPath = (item: ItemSummary): string | null => {
  if (item.type === 'movie') return `/movies/${item.id}`
  if (item.type === 'show') return `/shows/${item.id}`
  if (item.type === 'episode') return `/episodes/${item.id}`
  return item.show && item.season != null
    ? seasonPath({ showId: item.show.id, season: item.season })
    : null
}

/** Where an episode's page leads back to: its season, else its show, else its library. */
export const episodeBackPath = ({
  item,
  libraryId,
}: {
  item: ItemSummary
  libraryId: number
}): string => {
  if (!item.show) return `/libraries/${libraryId}`
  return item.season == null
    ? `/shows/${item.show.id}`
    : seasonPath({ showId: item.show.id, season: item.season })
}

/**
 * The link to play a video, with the video riding along in router state so
 * the player starts without fetching it again.
 */
export const watchLink = (media: MediaItem): { to: string; state: { media: MediaItem } } => ({
  to: `/watch/${media.id}`,
  state: { media },
})

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

/**
 * Where a card goes: a matched item's page where the library has pages, or
 * straight to the player, with the video handed over, for anything else. A
 * card a movie was split onto names its file, so the page plays that one.
 */
export const cardLink = ({
  media,
  pages,
}: {
  media: MediaItem
  pages: boolean
}): { to: string; state?: { media: MediaItem } } => {
  const page = pages && media.item ? itemPath(media.item) : null
  if (page == null) return watchLink(media)
  return media.variant == null ? { to: page } : { to: `${page}?file=${media.id}` }
}
