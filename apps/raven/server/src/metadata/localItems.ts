import type { FetchedItem } from '@/metadata/tmdbClient'

/** Items raven made up for episodes and seasons TMDB does not list; never fetched. */
export const LOCAL = 'local:'

export const isLocal = (tmdbId: string): boolean => tmdbId.startsWith(LOCAL)

const blank = (item: Pick<FetchedItem, 'type' | 'tmdbId' | 'number' | 'title'>): FetchedItem => ({
  ...item,
  originalTitle: null,
  year: null,
  released: null,
  ended: null,
  summary: null,
  tagline: null,
  contentRating: null,
  runtime: null,
  studio: null,
  genres: [],
  imdbId: null,
  tvdbId: null,
  images: { poster: null, backdrop: null, still: null },
  credits: [],
  rating: null,
  reviews: [],
})

/** A season TMDB does not list, so its files still have somewhere to sit. */
export const localSeason = ({
  showTmdbId,
  number,
}: {
  showTmdbId: string
  number: number
}): FetchedItem =>
  blank({
    type: 'season',
    tmdbId: `${LOCAL}${showTmdbId}:S${number}`,
    number,
    title: number === 0 ? 'Specials' : `Season ${number}`,
  })

/** An episode TMDB does not list (another order, or absolute numbering), with its parsed name. */
export const localEpisode = ({
  showTmdbId,
  season,
  number,
  title,
}: {
  showTmdbId: string
  season: number
  number: number
  title: string | null
}): FetchedItem =>
  blank({
    type: 'episode',
    tmdbId: `${LOCAL}${showTmdbId}:S${season}E${number}`,
    number,
    title: title ?? `Episode ${number}`,
  })
