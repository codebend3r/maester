import { MIX_KINDS, type MixKind, plural } from '@raven/core'

type ArtistCountsProps = { albumCount: number; trackCount: number }

/** The words and phrases more than one part of the app says with one meaning, written once. */
export const COMMON_COPY = {
  cancel: 'Cancel',
  close: 'Close',
  play: 'Play',
  pause: 'Pause',
  shuffle: 'Shuffle',
  sort: 'Sort',
  download: 'Download',
  delete: 'Delete',
  deleteForGood: 'Delete for good',
  deleteOnceWatched: 'Delete once watched',
  fixMatch: 'Fix match',
  editImages: 'Edit images',
  editMetadata: 'Edit metadata',
  addLibrary: 'Add library',
  addToPlaylist: 'Add to playlist',
  signIn: 'Sign in',
  signOut: 'Sign out',
  signingOut: 'Signing out',
  backToSignIn: 'Back to sign in',
  loading: 'Loading',
  watched: 'Watched',
  favourite: 'Favourite',
  notMatched: 'Not matched',
  home: 'Home',
  library: 'Library',
  libraries: 'Libraries',
  favourites: 'Favourites',
  downloads: 'Downloads',
  history: 'History',
  settings: 'Settings',
  account: 'Account',
  all: 'All',
  albums: 'Albums',
  title: 'Title',
  year: 'Year',
  name: 'Name',
  file: 'File',
  hdr: 'HDR',
  tmdb: 'TMDB',
  imdb: 'IMDb',
  envFile: '.env',
  /** Between the facts on one line: "1997 · Album · 12 tracks". */
  separator: ' · ',
  /** Between the entries of a list read as one: "Alice, Bob". */
  listSeparator: ', ',
  episodes: (n: number) => plural({ n, one: 'episode', many: 'episodes' }),
  seasons: (n: number) => plural({ n, one: 'season', many: 'seasons' }),
  videos: (n: number) => plural({ n, one: 'video', many: 'videos' }),
  tracks: (n: number) => plural({ n, one: 'track', many: 'tracks' }),
} as const

export const MUSIC_COPY = {
  /** What each mix is called, on Home and its own page. */
  mixNames: {
    [MIX_KINDS.heavyRotation]: 'Heavy rotation',
    [MIX_KINDS.rediscover]: 'Rediscover',
    [MIX_KINDS.onThisDay]: 'On this day',
    [MIX_KINDS.recentlyAdded]: 'Recently added',
  } as const satisfies Record<MixKind, string>,
  noMusic: 'raven has no music library yet.',
  minutes: (minutes: number) => `${minutes} min`,
  artistCounts: ({ albumCount, trackCount }: ArtistCountsProps) =>
    `${plural({ n: albumCount, one: 'album', many: 'albums' })}${COMMON_COPY.separator}${COMMON_COPY.tracks(trackCount)}`,
} as const
