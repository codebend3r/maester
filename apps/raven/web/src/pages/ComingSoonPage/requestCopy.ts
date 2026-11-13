import {
  ITEM_TYPES,
  type MatchItemType,
  REQUEST_STATUSES,
  type RequestBudget,
  type RequestStatus,
} from '@raven/core'

/** What each status says: a short label for a card, and a line under it on the title's page. */
export const REQUEST_STATUS_COPY = {
  [REQUEST_STATUSES.searching]: {
    label: 'Searching',
    line: 'The server is looking for a copy to download.',
  },
  [REQUEST_STATUSES.notDownloadable]: {
    label: 'Not downloadable',
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
} as const satisfies Record<RequestStatus, { label: string; line: string }>

const TIME_FORMAT = new Intl.DateTimeFormat(undefined, {
  weekday: 'short',
  hour: 'numeric',
  minute: '2-digit',
})

export const REQUEST_COPY = {
  heading: 'Request',
  request: 'Request download',
  requesting: 'Requesting',
  requestedByYou: 'You requested this. Everyone can watch it once it arrives.',
  requestedBySomeone: 'Someone has requested this. Everyone can watch it once it arrives.',
  requestedAlready: 'This is requested already. Everyone can watch it once it arrives.',
  left: ({ left, limit }: Pick<RequestBudget, 'left' | 'limit'>) =>
    `${left} of ${limit} requests left today`,
  spent: (limit: number) => `You have used all ${limit} of today's requests.`,
  nextAt: (at: string) => `Your next one comes back ${TIME_FORMAT.format(new Date(at))}.`,
  off: {
    [ITEM_TYPES.movie]: 'Movie requests are off on this server.',
    [ITEM_TYPES.show]: 'TV show requests are off on this server.',
  } as const satisfies Record<MatchItemType, string>,
  explain: 'One request downloads it for everyone, so nobody needs to ask twice.',
  failed: 'The request did not go through.',
} as const
