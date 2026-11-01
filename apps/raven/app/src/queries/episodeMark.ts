import { ITEM_TYPES, type MediaItem } from '@raven/core'

type EpisodeMarkOfProps = { season: number | null; episode: number | null }

const pad = (n: number): string => String(n).padStart(2, '0')

/**
 * An episode's place in short: "S02 · E05", or "Special 5" for one of season 0; null without a
 * season. The pages and the player use it in place of the words, which crowd a TV.
 */
export const episodeMarkOf = ({ season, episode }: EpisodeMarkOfProps): string | null => {
  if (season === null) return null
  if (season === 0) return episode === null ? 'Specials' : `Special ${episode}`
  return episode === null ? `S${pad(season)}` : `S${pad(season)} · E${pad(episode)}`
}

/**
 * An episode's place as its card says it, on one line and unpadded: "S5.E1", or "S5" for a
 * season; a special reads as `episodeMarkOf` does. Null without a season.
 */
export const cardMarkOf = ({ season, episode }: EpisodeMarkOfProps): string | null => {
  if (season === null || season === 0) return episodeMarkOf({ season, episode })
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
