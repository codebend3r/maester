import {
  PLAY_HISTORY_SHOWS,
  type PlayHistoryShow,
  REACH_KINDS,
  type Reach,
  formatDuration,
  plural,
} from '@raven/core'

/** The play history's pages: each account's own, and everyone's for the owner. */
export const PLAY_HISTORY_ROUTES = {
  own: '/history',
  everyone: '/history/everyone',
} as const

/** The address's search params the pages read. */
export const PLAY_HISTORY_SEARCH = { show: 'show', account: 'account' } as const

/** How far a sitting got, in words: finished, a listen that only counted, or the spot and its share. */
const reachText = (reach: Reach): string => {
  switch (reach.kind) {
    case REACH_KINDS.finished:
      return 'Finished'
    // A music listen kept from before the history, which noted only that it counted.
    case REACH_KINDS.unknown:
      return 'Listened'
    case REACH_KINDS.partial:
      return reach.duration === null || reach.percent === null
        ? formatDuration(reach.furthest)
        : `${formatDuration(reach.furthest)} of ${formatDuration(reach.duration)} (${reach.percent}%)`
    default: {
      const unreachable: never = reach
      return unreachable
    }
  }
}

type AlbumRunProps = {
  album: string
  artist: string | null
  heard: number
  total: number
  isWhole: boolean
}

export const PLAY_HISTORY_COPY = {
  title: 'Play history',
  everyoneTitle: 'Everyone’s history',
  intro: 'Everything you played, newest first: every video and every track, however briefly.',
  everyoneIntro: 'Everything every account played, newest first.',
  managersOnlyFor: 'see what everyone played',
  seeEveryone: 'See everyone’s history',
  show: 'Show',
  shows: {
    [PLAY_HISTORY_SHOWS.all]: 'Everything',
    [PLAY_HISTORY_SHOWS.video]: 'Videos',
    [PLAY_HISTORY_SHOWS.music]: 'Music',
  } as const satisfies Record<PlayHistoryShow, string>,
  account: 'Account',
  everyone: 'Everyone',
  /** The viewer of a server without accounts, and every play kept from before accounts. */
  thisServer: 'This server',
  table: 'What was played',
  columns: {
    when: 'Played',
    title: 'Title',
    from: 'From',
    library: 'Library',
    reach: 'How far',
    account: 'Account',
  },
  reach: reachText,
  albumRun: ({ album, artist, heard, total, isWhole }: AlbumRunProps) => {
    const by = artist === null ? album : `${album} by ${artist}`
    if (isWhole) return `${by}: the whole album`
    return `${by}: ${heard} of ${plural({ n: total, one: 'track', many: 'tracks' })}`
  },
  more: 'Show more',
  loading: 'Reading the history',
  nothing: 'Nothing has played yet.',
  nothingOfKind: 'Nothing of this kind has played yet.',
  serverDidNotAnswer: 'The server did not answer: ',
} as const
