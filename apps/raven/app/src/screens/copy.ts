import { REQUESTS_COPY, type RangeHintProps, playbackPrefsCopy } from '@raven/ui/headless'

import { LIBRARIES_ENTRY } from '@/layouts/copy'
import { BINGE_COPY } from '@/queries/bingeCards'
import { CONTINUE_WATCHING } from '@/queries/homeShelves'

export const HOME_COPY = {
  title: 'Home',
  loading: 'Gathering your libraries',
  bare: 'Nothing to show yet. Pin a library in its settings and its newest videos show here, and whatever you start watching waits at the top.',
} as const

type ResumeFromProps = { at: string }

export const ITEM_COPY = {
  opening: 'Opening the title',
  missing: 'This title is not on the server.',
  play: 'Play',
  /** "Play S01E02" for the episode a show or season plays next. */
  playEpisode: (code: string) => `Play ${code}`,
  resumeFrom: ({ at }: ResumeFromProps) => `Resume from ${at}`,
  fromStart: 'Play from the beginning',
  rewatch: 'Rewatch',
  nextEpisode: 'Next episode',
  /** "Next S01E03": the episode after this one in its show. */
  nextCode: (code: string) => `Next ${code}`,
  playAll: 'Play all',
  shuffle: 'Shuffle',
  /** A movie's or an episode's Watched: what pressing it does, then that it is. */
  videoWatched: { mark: 'Mark watched', marked: 'Watched' },
  /** A show's Watched, over every episode of every season. */
  showWatched: { mark: 'Mark show watched', marked: 'Show watched' },
  /** A season's Watched, over every episode in it. */
  seasonWatched: { mark: 'Mark season watched', marked: 'Season watched' },
  favourite: 'Favourite',
  binge: 'Binge',
  markBinging: 'Mark as binging',
  binging: 'Binging',
  /** What a show's Binge says while three other shows fill the list. */
  bingeLimit: 'You can binge up to three shows. Remove a show to make room for another.',
} as const

type FinishedEmptyProps = { name: string; percent: number }

export const LIBRARY_COPY = {
  library: 'Library',
  opening: 'Opening the library',
  missing: 'This library is not on the server.',
  nothingInProgress: 'Nothing in progress here yet.',
  showPage: (page: string) => `Show ${page}`,
  gathering: {
    shows: 'Gathering the shows',
    videos: 'Gathering the videos',
    sagas: 'Gathering the sagas',
    favourites: 'Gathering the favourites',
    finished: 'Gathering what was finished',
  },
  sagas: 'Sagas',
  all: 'All',
  inProgressPage: 'In progress',
  favourites: 'Favourites',
  finishedPage: 'Finished',
  /** The main pages' names as an iPad's tabs beside the library's name. */
  tabs: { continue: 'Continue Watching', browse: 'Browse', favourites: 'Favourites' },
  favourite: { one: 'favourite', many: 'favourites' },
  finished: { one: 'video finished', many: 'videos finished' },
  favouritesEmpty: (name: string) =>
    `No favourites in ${name} yet. Hold a video and choose Add to favourites, or press the heart on a show's page.`,
  finishedEmpty: ({ name, percent }: FinishedEmptyProps) =>
    `Nothing finished in ${name} yet. A video counts once playback gets ${percent}% of the way through, or when you mark it watched.`,
  saga: { one: 'saga', many: 'sagas' },
  sagasEmpty: (name: string) =>
    `No sagas in ${name} yet. One shows here once two movies or more from the same TMDB collection are in the library.`,
  sort: 'Sort',
  order: (direction: string) => `Order: ${direction}`,
  view: 'View',
  groupBy: 'Group by',
  search: (library: string) => `Search ${library}`,
  videos: { one: 'video', many: 'videos' },
  shows: { one: 'show', many: 'shows' },
  inProgress: { one: 'video in progress', many: 'videos in progress' },
  shuffle: 'Shuffle',
  shuffleLibrary: (library: string) => `Shuffle ${library}`,
  lock: 'Lock',
  lockLibrary: (library: string) => `Lock ${library} again: the PIN is asked for it the next time`,
} as const

export const PLAYER_SCREEN_COPY = {
  opening: 'Opening the video',
  missing: 'This video is not on the server.',
} as const

export const SEARCH_COPY = {
  title: 'Search',
  label: 'Search every library',
  searching: 'Searching every library',
  /** What the screen says when a search finds nothing, as the web's Home says it. */
  nothingMatches: (query: string) => `Nothing in any library matches "${query}".`,
} as const

export const FAVOURITES_COPY = {
  title: 'Favourites',
  gathering: 'Gathering your favourites',
  none: 'Nothing is a favourite yet. Mark a title, an album or an artist with its heart and it waits here.',
  count: { one: 'favourite', many: 'favourites' },
} as const

export const CONTINUE_WATCHING_COPY = {
  title: CONTINUE_WATCHING,
  gathering: 'Gathering what you were watching',
  none: 'Nothing in progress. Start a video and it waits here.',
} as const

export const BINGE_PAGE_COPY = {
  title: BINGE_COPY.title,
  none: 'You have no shows set to binge. Mark a show as binging on its page and it waits here.',
} as const

export const LIBRARIES_COPY = {
  title: LIBRARIES_ENTRY.label,
  gathering: 'Gathering the libraries',
  none: 'No libraries here yet. An admin adds them on the web.',
  showMore: (library: string) => `Show more of ${library}`,
  showLess: (library: string) => `Show less of ${library}`,
  /** The Pin toggle, the web's: its words for the eye, and one name aloud whatever its state. */
  pin: 'Pin',
  pinned: 'Pinned',
  pinName: (library: string) => `Pin ${library}`,
} as const

export const SETTINGS_COPY = {
  title: 'Settings',
  account: 'Account',
  signedInAs: (email: string) => `Signed in as ${email}.`,
  signOut: 'Sign out',
  themeNote: 'How raven looks on this device.',
  playback: 'Playback',
  preferDirect: 'Prefer direct play',
  preferDirectHint:
    'Plays a file this device may refuse as it is first, and has the server convert it only if that fails.',
  allowTranscode: 'Allow transcoding',
  allowTranscodeHint:
    "Lets the server re-encode what this device can't play. Off, such a file doesn't play here.",
  away: 'Away from home',
  awayNote: 'The largest picture a transcode is sent at when raven is reached over the internet.',
  /** What the away cap is called, as the web's server settings name the same heights. */
  heights: { uhd: '4K', fullHd: '1080p', hd: '720p' },
  subtitles: 'Subtitles',
  subtitlesNote: 'How subtitles look on this device, on every video. Each device keeps its own.',
  subtitleSize: 'Size',
  subtitleColour: 'Colour',
  /** Settings' tabs, the web's, each a group of related settings; the owner's Admin last. */
  tabs: {
    label: 'Settings',
    playback: 'Playback',
    subtitles: 'Subtitles',
    servers: 'Servers',
    account: 'Account',
    thisApp: 'This app',
    advanced: 'Advanced',
    requests: 'Requests',
    admin: 'Admin',
  },
  ...playbackPrefsCopy({ press: 'press' }),
  upNext: 'Up next',
  advanced: {
    heading: 'Advanced',
    help: 'For this device only.',
    linger: "Hide the player's controls after",
    lingerHint: ({ min, max }: RangeHintProps) =>
      `How long the controls stay over the video once the screen or the remote goes quiet, from ${min} to ${max} seconds.`,
  },
  requests: REQUESTS_COPY,
} as const

/** Settings' Servers section, in the web's words but the https ones, which a device has no page to need. */
export const SERVERS_COPY = {
  heading: 'Servers',
  help: 'Where this app finds its media. The server in use gives every library, picture and stream; your servers and pins follow your account to every device.',
  home: 'Home',
  inUse: 'In use',
  tags: (tags: readonly string[]) => tags.join(' · '),
  use: 'Use',
  switchToName: (name: string) => `Use ${name}`,
  rename: 'Rename',
  renameName: (name: string) => `Rename ${name}`,
  newName: 'New name',
  save: 'Save',
  cancel: 'Cancel',
  remove: 'Remove',
  removeName: (name: string) => `Remove ${name}`,
  badName: 'A name needs 1 to 80 characters, with no hidden ones.',
  noAccount: 'Sign in to keep a name on your account.',
  add: 'Add server',
  adding: 'Checking',
  address: 'Server address',
  addressHint: 'Its address, as https://raven.example.com:8443.',
  signInToAdd: 'Sign in to keep more servers on your account.',
  failed: (message: string) => `That did not work: ${message}`,
  problems: {
    address:
      'That is not a server address. Type its http or https address, with its port if it has one.',
    listed: 'That server is already on your list.',
    full: 'Your list is full. Remove a server first.',
    unreachable: 'That server did not answer. Check the address and try again.',
    tooOld: 'That server is too old to switch to. Update it first.',
    signedOut: 'Sign in to keep more servers on your account.',
  },
} as const

export const SIGN_IN_COPY = {
  title: 'Sign in to continue',
  email: 'Email',
  password: 'Password',
  badAccount: 'Enter your email and password.',
  wrongAccount: 'Email or password is incorrect.',
  unreachable: "Couldn't reach raven. Check your connection and try again.",
  notAdded: "This server couldn't be added. Try its address again.",
  full: 'This device already keeps as many servers as it can.',
  signIn: 'Sign in',
  /** The spec's words for a server without `RAVEN_MEDIA_SECRET`, which the app then plays from with its cookie. */
  ticketsOff:
    "This server can't hand out media tickets. Set RAVEN_MEDIA_SECRET on it to play in the app",
  continue: 'Continue',
} as const

export const ALBUM_COPY = {
  opening: 'Opening the album',
  missing: 'This album is not on the server.',
} as const

export const SAGA_COPY = {
  opening: 'Opening the saga',
  missing: 'This saga is not on the server.',
  playAll: 'Play all',
} as const

export const ARTIST_COPY = {
  opening: 'Opening the artist',
  missing: 'This artist is not on the server.',
} as const

export const PLAYLIST_COPY = {
  opening: 'Opening the playlist',
  missing: 'This playlist is not on the server.',
  failed: (why: string) => `Could not change the playlist: ${why}`,
} as const
