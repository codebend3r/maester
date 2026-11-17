import { KIT_COPY } from '@/ui/copy'
import { factsLineOf } from '@/ui/counts'

export const SIGN_IN_COPY = {
  welcome: 'Welcome to Wren',
  note: 'Sign in with your raven account to play your music library anywhere.',
  title: 'Sign in',
  tabletNote: 'Use your raven account to play your music.',
  tagline: 'Your whole library, from your own server, wherever you are.',
  email: 'Email',
  emailPlaceholder: 'you@example.com',
  password: 'Password',
  passwordPlaceholder: 'Your password',
  showPassword: 'Show password',
  hidePassword: 'Hide password',
  enterEmail: 'Enter your email',
  enterPassword: 'Enter your password',
  badAccount: "Couldn't sign you in. Fill in both fields and try again.",
  wrongAccount: 'Email or password is incorrect.',
  unreachable: "Can't reach raven. Check the server address.",
  ticketsOff:
    "This server can't hand out media tickets. Set RAVEN_MEDIA_SECRET on it to play in Wren.",
  notAdded: "raven couldn't be added. Try again.",
  full: 'This device already keeps as many servers as it can.',
  family: 'Part of Maester',
  signIn: 'Sign in',
  continue: 'Continue',
} as const

type RemoveAllBodyProps = { size: string; server: string }

export const SETTINGS_COPY = {
  title: 'Settings',
  signOut: 'Sign out',
  server: 'Server',
  appearance: 'Appearance',
  system: 'System',
  light: 'Light',
  dark: 'Dark',
  about: 'About',
  version: 'Version',
  licenses: 'Licenses',
  licensesNote: 'The fonts Wren is set in',
  fonts: [
    {
      name: 'Young Serif',
      copyright:
        'Copyright 2023 The Young Serif Project Authors (https://github.com/noirblancrouge/YoungSerif)',
    },
    {
      name: 'Instrument Sans',
      copyright:
        'Copyright 2022 The Instrument Sans Project Authors (https://github.com/Instrument/instrument-sans)',
    },
  ],
  fontLicense:
    'This Font Software is licensed under the SIL Open Font License, Version 1.1, available with a FAQ at https://openfontlicense.org.',
  downloads: 'Downloads',
  downloadQuality: 'Download quality',
  cellularQuality: 'Streaming on cellular',
  /** The unit the bitrates are in, said once beside each choice's heading. */
  kbps: 'kbps',
  /** A choice's heading said with its unit: "Download quality, in kbps". */
  inKbps: (label: string) => `${label}, in kbps`,
  storageLimit: 'Storage limit',
  original: 'Original',
  usedByDownloads: 'Used by downloads',
  removeAll: 'Remove all downloads',
  removeAllTitle: 'Remove all downloads?',
  removeAllBody: ({ size, server }: RemoveAllBodyProps) =>
    `${size} of music will be deleted from this device. You can still stream it whenever ${server} is reachable.`,
  /** Who the dialog names when no server is active. */
  theServer: 'the server',
  remove: 'Remove',
} as const

type UsedOfProps = { used: string; limit: string }

/** How the downloads' storage is said, in Settings and on Library's Downloads alike. */
export const STORAGE_COPY = {
  /** No storage limit. */
  off: 'Off',
  gigabytes: (gigabytes: number) => `${gigabytes} GB`,
  usedOf: ({ used, limit }: UsedOfProps) => `${used} of ${limit}`,
} as const

type TrackOfProps = { at: number; count: number }

type ContinueLineProps = { artists: string; track: string }

type ContinueLabelProps = { album: string; line: string }

export const HOME_COPY = {
  title: 'Home',
  /** The large title, by the time of day. */
  greeting: {
    morning: 'Good morning',
    afternoon: 'Good afternoon',
    evening: 'Good evening',
  },
  continueListening: 'Continue listening',
  /** Where the queue stands: "Track 11 of 20". */
  trackOf: ({ at, count }: TrackOfProps) => `Track ${at} of ${count}`,
  /** The card's line under the album: "Sia · Track 11 of 20". */
  continueLine: ({ artists, track }: ContinueLineProps) => KIT_COPY.facts([artists, track]),
  /** The card read out: "Continue listening, 1000 Forms Of Fear, Sia · Track 11 of 20". */
  continueLabel: ({ album, line }: ContinueLabelProps) => `Continue listening, ${album}, ${line}`,
  resume: 'Resume',
  shuffleAll: 'Shuffle all',
  firstPlaylist: 'Create your first',
} as const

export const LIBRARY_PAGE_COPY = {
  /** A list the server did not answer for: what happened, and what to do. */
  failed: "Couldn't load your music. Check that raven is reachable, then try again.",
  title: 'Library',
  albums: 'Albums',
  artists: 'Artists',
  songs: 'Songs',
  playlists: 'Playlists',
  downloads: 'Downloads',
  recent: 'Recently added',
  search: 'Search',
  noneYet: 'None yet',
  noAlbums: 'No albums yet.',
  noArtists: 'No artists yet.',
  noSongs: 'No songs yet.',
  noMatches: 'Nothing matches that search.',
  searchAlbums: 'Search albums',
  searchArtists: 'Search artists',
  searchSongs: 'Search songs',
  sortBy: 'Sort by',
  /** The sort button read out: "Sort by, Title". */
  sortLabel: (sort: string) => `Sort by, ${sort}`,
  sorts: {
    title: 'Title',
    artist: 'Artist',
    year: 'Year',
    added: 'Recently added',
  },
  /** The A to Z rail's letter read out: "Jump to A". */
  jumpTo: (letter: string) => `Jump to ${letter}`,
  noPlaylists: 'No playlists yet',
  noPlaylistsHint: 'Build one from scratch, or add any song from its More menu.',
  /** The toast once a playlist is made: "Created Road trip". */
  created: (name: string) => `Created ${name}`,
  noDownloads: 'Nothing downloaded yet',
  noDownloadsHint: 'Download an album or playlist from its page.',
  onThisDevice: 'On this device',
  /** The download quality: "256 kbps downloads". */
  quality: (kbps: number) => `${kbps} kbps downloads`,
  manage: 'Manage',
  manageLabel: 'Manage downloads in Settings',
} as const

export const OFFLINE_COPY = {
  title: "Can't reach raven",
  /** The way from Home's notice, when the server is out of reach, to what plays without it. */
  playDownloads: 'Play your downloads',
} as const

/** What an album's, an artist's and a playlist's pages say around what they hold. */
export const DETAIL_COPY = {
  more: 'More options',
  /** A whole hour count of a collection's length: "1 hr". */
  hours: (hours: number) => `${hours} hr`,
  /** The minutes past the hour: "24 min". */
  minutes: (minutes: number) => `${minutes} min`,
  /** A length's parts on one line: "1 hr 24 min". */
  length: (parts: readonly string[]) => parts.join(' '),
  /** The tablet tracklist's column headings. */
  columns: { number: '#', title: 'Title', time: 'Time' },
} as const

export const ALBUM_COPY = {
  opening: 'Opening the album',
  missing: 'This album is not on the server.',
  openArtist: (name: string) => `Go to ${name}`,
  /** The toast once the album's tracks are queued: "OK Computer added to the queue". */
  queued: (title: string) => `${title} added to the queue`,
} as const

export const ARTIST_COPY = {
  opening: 'Opening the artist',
  missing: 'This artist is not on the server.',
  albums: 'Albums',
  appearsOn: 'Appears on',
} as const

export const PLAYLIST_COPY = {
  opening: 'Opening the playlist',
  missing: 'This playlist is not on the server.',
  emptyTitle: 'No songs yet',
  empty: (name: string) => `Nothing in ${name} yet. Add songs from any track's menu.`,
  /** The toast once the playlist's tracks are queued. */
  queued: (name: string) => `${name} added to the queue`,
} as const

type TopResultKindProps = { kind: string }

type RecentLineProps = { kind: string; artists: string }

export const SEARCH_COPY = {
  title: 'Search',
  label: 'Search your music',
  searching: 'Searching',
  failed: 'Search failed',
  failedHint: (reason: string) => `${reason} Check that raven is reachable, then search again.`,
  noMusicHint: 'Add a music library on raven, then search here.',
  noMatches: (query: string) => `No matches for “${query}”`,
  noMatchesHint:
    'Check the spelling or try a shorter search. Wren looks across every library on raven.',
  clearSearch: 'Clear search',
  filters: 'Show results',
  all: 'All',
  albums: 'Albums',
  artists: 'Artists',
  songs: 'Songs',
  downloaded: 'Downloaded',
  browse: 'Browse',
  recent: 'Recent',
  clearRecent: 'Clear',
  clearRecentLabel: 'Clear recent searches',
  removeRecent: (title: string) => `Remove ${title} from recent searches`,
  /** What a recent search was: "Artist", "Search", "Album · Bruno Mars". */
  recentSearch: 'Search',
  recentArtist: 'Artist',
  recentAlbum: ({ kind, artists }: RecentLineProps) => KIT_COPY.facts([kind, artists]),
  album: 'Album',
  song: 'Song',
  artist: 'Artist',
  /** The top result's overline: "Top result · Song". */
  topResult: ({ kind }: TopResultKindProps) => KIT_COPY.facts(['Top result', kind]),
  play: (title: string) => `Play ${title}`,
} as const

type QueueEntryLabelProps = { title: string; line: string }

type OutputProps = { server: string; device: string }

type SourceLineProps = { source: string | null; songs: string }

type RowLineProps = { artists: string; length: string }

/** Where the queue plays from, in one line: "From 1000 Forms Of Fear". */
const fromName = (name: string) => `From ${name}`

export const NOW_PLAYING_COPY = {
  close: 'Close Now Playing',
  more: 'More options',
  nothing: 'Nothing is playing.',
  clear: 'Clear',
  clearLabel: 'Clear up next',
  nothingNext: 'Nothing else is queued.',
  noLyrics: 'No lyrics for this song',
  instrumental: '♪',
  moveUp: 'Move up',
  moveDown: 'Move down',
  remove: 'Remove',
  /** The overline over the header's name, by where the queue started. */
  from: {
    album: 'Playing from album',
    playlist: 'Playing from playlist',
    artist: 'Playing from artist',
    other: 'Now playing',
  },
  /** The tablet header's one line: "From 1000 Forms Of Fear". */
  fromShort: (name: string) => fromName(name),
  /** Up next's line: "From 1000 Forms Of Fear · 9 songs", or "9 songs" with no source. */
  sourceLine: ({ source, songs }: SourceLineProps) =>
    factsLineOf([source === null ? null : fromName(source), songs]),
  /** The Output pill: "raven · This iPhone". */
  output: ({ server, device }: OutputProps) => KIT_COPY.facts([server, `This ${device}`]),
  /** The tablet's output status: "Playing on this iPad". */
  playingOn: (device: string) => `Playing on this ${device}`,
  /** The device Wren plays on, by what it runs on. */
  devices: { iPhone: 'iPhone', iPad: 'iPad', android: 'Android' },
  /** A queued song's line: "Sia · 3:36". */
  rowLine: ({ artists, length }: RowLineProps) => KIT_COPY.facts([artists, length]),
  /** A book's speed: "1.25×". */
  speedOf: (speed: number) => `${speed}×`,
  /** The volume, read out: "80%". */
  percent: (volume: number) => `${Math.round(volume * 100)}%`,
  /** A queued track as it is read out: "Airbag, Radiohead". */
  entry: ({ title, line }: QueueEntryLabelProps) =>
    KIT_COPY.labelled({ label: title, value: line }),
} as const
