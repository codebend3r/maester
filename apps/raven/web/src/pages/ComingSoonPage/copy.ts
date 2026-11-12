import {
  ITEM_TYPES,
  type MatchItemType,
  type TitleRequestAsk,
  UPCOMING_SHELVES,
  UPCOMING_TITLE_PARAMS,
  type UpcomingShelf,
} from '@raven/core'

/** The page that shelves what TMDB says is still to come. */
export const COMING_SOON_PATH = '/coming-soon'

/** Where a shelf's own page is. */
export const comingSoonShelfPath = (shelf: UpcomingShelf): string => `${COMING_SOON_PATH}/${shelf}`

/** The route of an upcoming title's own page. */
export const COMING_SOON_TITLE_ROUTE = `${COMING_SOON_PATH}/:${UPCOMING_TITLE_PARAMS.type}/:${UPCOMING_TITLE_PARAMS.tmdbId}`

/** Where an upcoming title's own page is: `/coming-soon/movie/123`. */
export const comingSoonTitlePath = ({ type, tmdbId }: TitleRequestAsk): string =>
  `${COMING_SOON_PATH}/${type}/${tmdbId}`

export const COMING_SOON_COPY = {
  title: 'Coming soon',
  intro: 'Movies and TV shows on their way, the most anticipated first.',
  loading: 'Finding what is coming soon',
  loadingMore: 'Finding more',
  empty: 'Nothing announced yet.',
  viewOnTmdb: 'View on TMDB',
  notFound: 'This title could not be found.',
  minutes: (minutes: number) => `${minutes} min`,
  kinds: {
    [ITEM_TYPES.movie]: 'Movie',
    [ITEM_TYPES.show]: 'TV show',
  } as const satisfies Record<MatchItemType, string>,
  /** Each shelf's own page: its title and the line under it. */
  shelves: {
    [UPCOMING_SHELVES.movies]: {
      title: 'Upcoming movies',
      intro: 'Every movie on its way, the soonest out first.',
    },
    [UPCOMING_SHELVES.shows]: {
      title: 'Upcoming TV shows',
      intro: 'Every TV show on its way, the soonest to start first.',
    },
    [UPCOMING_SHELVES.documentaries]: {
      title: 'Upcoming documentaries',
      intro: 'Every documentary film and series on its way, the soonest out first.',
    },
  } as const satisfies Record<UpcomingShelf, { title: string; intro: string }>,
} as const
