import {
  ITEM_TYPES,
  type MatchItemType,
  UPCOMING_KINDS,
  UPCOMING_SHELVES,
  type UpcomingKind,
  type UpcomingShelf,
} from '@raven/core'

export const COMING_SOON_COPY = {
  title: 'Coming soon',
  intro: 'Movies and TV shows on their way, the most anticipated first.',
  loading: 'Finding what is coming soon',
  loadingMore: 'Finding more',
  empty: 'Nothing announced yet.',
  viewOnTmdb: 'View on TMDB',
  notFound: 'This title could not be found.',
  minutes: (minutes: number) => `${minutes} min`,
  tabs: {
    label: 'Coming soon',
    upcoming: 'Upcoming',
    pending: 'Pending',
    added: 'Requests Added',
    everyone: 'All requests',
  },
  /** The All requests tab: every account's requests as a table, for whoever manages raven. */
  everyone: {
    reading: 'Reading everyone’s requests',
    failed: 'Could not read everyone’s requests: ',
    none: 'Nothing has been requested yet.',
    table: 'Everyone’s requests',
    columns: {
      title: 'Title',
      status: 'Status',
      requestedBy: 'Requested by',
      requested: 'Requested',
    },
    thisServer: 'This server',
    /** Who a title is down to when its downloader took it on with nobody asking. */
    downloaders: {
      [ITEM_TYPES.movie]: 'Radarr',
      [ITEM_TYPES.show]: 'Sonarr',
    },
    managersOnly: 'Only whoever manages raven can see what everyone requested.',
  },
  /** The Pending and Added tabs: the caller's requests, and the titles the downloaders hold already, as posters. */
  requests: {
    reading: 'Reading your requests',
    failed: 'Could not read your requests: ',
    requestedOn: (day: string) => `Requested ${day}`,
    pending: {
      none: 'Nothing is on its way. Open a title in Upcoming to request it.',
      list: 'Requests on their way',
    },
    added: {
      none: 'Nothing requested has arrived yet. Each title shows here once it has downloaded.',
      list: 'Requests that have arrived',
      status: 'In the library',
    },
  },
  kinds: {
    [ITEM_TYPES.movie]: 'Movie',
    [ITEM_TYPES.show]: 'TV show',
  } as const satisfies Record<MatchItemType, string>,
  /** What a title's own page says it is. */
  upcomingKinds: {
    [UPCOMING_KINDS.movie]: 'Movie',
    [UPCOMING_KINDS.show]: 'TV show',
    [UPCOMING_KINDS.documentary]: 'Documentary',
    [UPCOMING_KINDS.animeMovie]: 'Anime movie',
    [UPCOMING_KINDS.animeShow]: 'Anime show',
  } as const satisfies Record<UpcomingKind, string>,
  /** A shelf page's checkbox, which leaves out the titles someone asked for or a downloader holds. */
  hideRequested: 'Hide requested',
  allRequested: 'Everything here is requested already. Clear “Hide requested” to see it.',
  /** Each shelf's own page: its title and the line under it. */
  shelves: {
    [UPCOMING_SHELVES.movies]: {
      title: 'Upcoming movies',
      intro: 'Every movie on its way, the most anticipated first.',
    },
    [UPCOMING_SHELVES.shows]: {
      title: 'Upcoming TV shows',
      intro: 'Every TV show on its way, the most anticipated first.',
    },
    [UPCOMING_SHELVES.documentaries]: {
      title: 'Upcoming documentaries',
      intro: 'Every documentary film and series on its way, the most anticipated first.',
    },
    [UPCOMING_SHELVES.anime]: {
      title: 'Upcoming anime',
      intro: 'Every anime movie and series on its way, the most anticipated first.',
    },
  } as const satisfies Record<UpcomingShelf, { title: string; intro: string }>,
} as const
