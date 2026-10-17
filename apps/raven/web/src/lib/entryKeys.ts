import type { EpisodeSummary, ItemSummary, MediaItem, Saga, SeasonSummary } from '@raven/core'

/** How a card names its entry, as `data-entry`: the jump strip and select mode find it by this. */
export const mediaEntryKey = (media: MediaItem): string => `media:${media.id}`
export const showEntryKey = (show: ItemSummary): string => `show:${show.id}`
export const seasonEntryKey = (season: Pick<SeasonSummary, 'id'>): string => `season:${season.id}`
export const episodeEntryKey = (episode: Pick<EpisodeSummary, 'id'>): string =>
  `episode:${episode.id}`
export const sagaEntryKey = (saga: Pick<Saga, 'tmdbId'>): string => `saga:${saga.tmdbId}`
