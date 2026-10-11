import type { ItemSummary, MediaItem, Rating, RatingSource } from '@/contract'

const pad = (value: number): string => String(value).padStart(2, '0')

/** "S01E02", or "S01" for a season; null when there is no number to show. */
export const episodeCode = ({
  season,
  episode,
}: {
  season: number | null
  episode: number | null
}): string | null => {
  if (season == null) return null
  return episode == null ? `S${pad(season)}` : `S${pad(season)}E${pad(episode)}`
}

/** "The Matrix (1999)", or "Severance · S01E02 · Half Loop" for an episode. */
export const itemLabel = (item: ItemSummary): string => {
  if (item.type === 'episode' || item.type === 'season') {
    return [
      item.show?.title ?? null,
      episodeCode(item),
      item.type === 'episode' ? item.title : null,
    ]
      .filter((part): part is string => part != null && part !== '')
      .join(' · ')
  }
  return item.year == null ? item.title : `${item.title} (${item.year})`
}

/**
 * The name a video goes by outside its library page: the history, the
 * favourites and the player. A matched file takes its item's name; an
 * unmatched one in a Movies library its parsed title and year.
 */
export const mediaLabel = (media: MediaItem): string => {
  if (media.item) return itemLabel(media.item)
  return media.year == null ? media.title : `${media.title} (${media.year})`
}

/** The title a card shows, and the year beneath it. */
export const cardTitle = (media: MediaItem): { title: string; year: number | null } =>
  media.item
    ? { title: media.item.title, year: media.item.year }
    : { title: media.title, year: media.year }

/** The score a card shows: the library's chosen source, else TMDB's, else none. */
export const pickScore = ({
  ratings,
  source,
}: {
  ratings: readonly Rating[]
  source: RatingSource
}): Rating | null =>
  ratings.find((rating) => rating.source === source) ??
  ratings.find((rating) => rating.source === 'tmdb') ??
  null

/** How a score reads for its source: "82%", "7.5" out of 10, or "74" out of 100. */
export const formatScore = (rating: Rating): string => {
  if (rating.source === 'imdb') return rating.value.toFixed(1)
  if (rating.source === 'metacritic') return String(Math.round(rating.value * 10))
  return `${Math.round(rating.value * 10)}%`
}
