import { BLANK_ITEM, type FetchedItem } from '@/metadata/tmdbClient'

/** Items raven made up for episodes and seasons TMDB does not list; never fetched. */
export const LOCAL = 'local:'

export const isLocal = (tmdbId: string): boolean => tmdbId.startsWith(LOCAL)

type LocalSeasonProps = {
  showTmdbId: string
  number: number
}

/** A season TMDB does not list, so its files still have somewhere to sit. */
export const localSeason = ({ showTmdbId, number }: LocalSeasonProps): FetchedItem => ({
  ...BLANK_ITEM,
  type: 'season',
  tmdbId: `${LOCAL}${showTmdbId}:S${number}`,
  number,
  title: number === 0 ? 'Specials' : `Season ${number}`,
})

type LocalEpisodeProps = {
  showTmdbId: string
  season: number
  number: number
  title: string | null
}

/** An episode TMDB does not list (another order, or absolute numbering), with its parsed name. */
export const localEpisode = ({
  showTmdbId,
  season,
  number,
  title,
}: LocalEpisodeProps): FetchedItem => ({
  ...BLANK_ITEM,
  type: 'episode',
  tmdbId: `${LOCAL}${showTmdbId}:S${season}E${number}`,
  number,
  title: title ?? `Episode ${number}`,
})
