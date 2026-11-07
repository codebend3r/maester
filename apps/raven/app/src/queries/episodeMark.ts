import { ITEM_TYPES, type MediaItem, episodeTag } from '@raven/core'

type CardMarkOfProps = { season: number | null; episode: number | null }

/**
 * An episode's place as its card says it, on one line and unpadded: "S5.E1", or "S5" for a
 * season; a special reads as core's `episodeTag` says it. Null without a season.
 */
export const cardMarkOf = ({ season, episode }: CardMarkOfProps): string | null => {
  if (season === null || season === 0) return episodeTag({ season, episode })
  return episode === null ? `S${season}` : `S${season}.E${episode}`
}

/** What an episode's card says under its picture: the episode's name, and its place. */
export type EpisodeWords = { name: string; mark: string | null }

/** The words of an episode's card; null for a video that is not a matched episode. */
export const episodeWordsOf = (media: MediaItem): EpisodeWords | null => {
  const { item } = media
  if (item === null || item.type !== ITEM_TYPES.episode) return null
  return {
    name: item.title === '' ? media.title : item.title,
    mark: cardMarkOf(item),
  }
}
