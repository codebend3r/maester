import { ITEM_TYPES, type MatchItemType, UPCOMING_SHELVES, type UpcomingShelf } from '@raven/core'

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
