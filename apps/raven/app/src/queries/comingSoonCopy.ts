import {
  ITEM_TYPES,
  type MatchItemType,
  REQUEST_STATUSES,
  type RequestBudget,
  type RequestStatus,
  UPCOMING_KINDS,
  UPCOMING_SHELVES,
  type UpcomingKind,
  type UpcomingShelf,
} from '@raven/core'

/** Coming soon's pages, the web's tabs: what is on its way, the caller's requests still pending, those added, and every account's for the owner. */
export const COMING_SOON_PAGES = {
  upcoming: 'upcoming',
  pending: 'pending',
  added: 'added',
  everyone: 'everyone',
} as const

export type ComingSoonPage = (typeof COMING_SOON_PAGES)[keyof typeof COMING_SOON_PAGES]

type RequestedByOnProps = { who: string; day: string }

/** Coming soon's words, the web's. */
export const COMING_SOON_COPY = {
  title: 'Coming soon',
  intro: 'Movies and TV shows on their way, the most anticipated first.',
  loading: 'Finding what is coming soon',
  empty: 'Nothing announced yet.',
  notFound: 'This title could not be found.',
  minutes: (minutes: number) => `${minutes} min`,
  directedBy: (names: string) => `Directed by ${names}`,
  cast: 'Cast',
  separator: ' · ',
  listSeparator: ', ',
  and: ' and ',
  lastAnd: ', and ',
  showPage: (name: string) => `Show ${name}`,
  pages: {
    [COMING_SOON_PAGES.upcoming]: 'Upcoming',
    [COMING_SOON_PAGES.pending]: 'Pending',
    [COMING_SOON_PAGES.added]: 'Requests Added',
    [COMING_SOON_PAGES.everyone]: 'All requests',
  } as const satisfies Record<ComingSoonPage, string>,
  shelves: {
    [UPCOMING_SHELVES.movies]: 'Upcoming movies',
    [UPCOMING_SHELVES.shows]: 'Upcoming TV shows',
    [UPCOMING_SHELVES.documentaries]: 'Upcoming documentaries',
    [UPCOMING_SHELVES.anime]: 'Upcoming anime',
  } as const satisfies Record<UpcomingShelf, string>,
  kinds: {
    [ITEM_TYPES.movie]: 'Movie',
    [ITEM_TYPES.show]: 'TV show',
  } as const satisfies Record<MatchItemType, string>,
  upcomingKinds: {
    [UPCOMING_KINDS.movie]: 'Movie',
    [UPCOMING_KINDS.show]: 'TV show',
    [UPCOMING_KINDS.documentary]: 'Documentary',
    [UPCOMING_KINDS.animeMovie]: 'Anime movie',
    [UPCOMING_KINDS.animeShow]: 'Anime show',
  } as const satisfies Record<UpcomingKind, string>,
  requests: {
    reading: 'Reading your requests',
    failed: 'Could not read your requests: ',
    requestedOn: (day: string) => `Requested ${day}`,
    inLibrary: 'In the library',
    none: {
      [COMING_SOON_PAGES.pending]: 'Nothing is on its way. Open a title in Upcoming to request it.',
      [COMING_SOON_PAGES.added]:
        'Nothing requested has arrived yet. Each title shows here once it has downloaded.',
    },
  },
  everyone: {
    reading: 'Reading everyone’s requests',
    failed: 'Could not read everyone’s requests: ',
    none: 'Nothing has been requested yet.',
    thisServer: 'This server',
    downloaders: {
      [ITEM_TYPES.movie]: 'Radarr',
      [ITEM_TYPES.show]: 'Sonarr',
    } as const satisfies Record<MatchItemType, string>,
  },
  statuses: {
    [REQUEST_STATUSES.searching]: {
      label: 'Searching',
      line: 'The server is looking for a copy to download.',
    },
    [REQUEST_STATUSES.notDownloadable]: {
      label: 'Tracked and ready',
      line: 'Nothing could be found to download yet. The server keeps looking and starts once a copy turns up.',
    },
    [REQUEST_STATUSES.willDownload]: {
      label: 'Will download soon',
      line: 'A copy was found and is waiting its turn to download.',
    },
    [REQUEST_STATUSES.downloading]: {
      label: 'Currently downloading',
      line: 'It is downloading now.',
    },
    [REQUEST_STATUSES.downloaded]: {
      label: 'Download complete, moving to library',
      line: 'It has downloaded and is on its way into the library.',
    },
  } as const satisfies Record<RequestStatus, { label: string; line: string }>,
  request: {
    request: 'Request download',
    requesting: 'Requesting',
    requested: 'Requested',
    requestedByOn: ({ who, day }: RequestedByOnProps) => `Requested by ${who} on ${day}.`,
    requestedBy: (who: string) => `Requested by ${who}.`,
    you: 'you',
    someone: 'someone',
    left: ({ left, limit, isUnlimited }: RequestBudget) =>
      isUnlimited ? 'Unlimited requests' : `${left} of ${limit} requests left today`,
    spent: (limit: number) => `You have used all ${limit} of today's requests.`,
    nextAt: (at: string) => `Your next one comes back ${at}.`,
    off: {
      [ITEM_TYPES.movie]: 'Movie requests are off on this server.',
      [ITEM_TYPES.show]: 'TV show requests are off on this server.',
    } as const satisfies Record<MatchItemType, string>,
    explain: 'One request downloads it for everyone, so nobody needs to ask twice.',
    failed: 'The request did not go through.',
  },
} as const
