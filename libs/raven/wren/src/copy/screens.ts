import { ARTIST_BACKGROUND_KINDS, type ArtistBackgroundKind } from '@raven/core'
import { KIT_COPY, factsLineOf } from '@/copy/kit'
import { COLOR_SCHEMES, THEME_MODES, WREN_THEMES } from '@/themes'

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
  /** What the phone approving the TV's code to scan is told is asking. */
  tvName: 'Wren on your TV',
} as const

type RemoveAllBodyProps = { size: string; server: string }

export const SETTINGS_COPY = {
  title: 'Settings',
  signOut: 'Sign out',
  server: 'Server',
  /** The label of the field that names the server on the account. */
  serverName: 'Name',
  serverNameError: 'Use up to 80 characters, with no hidden ones.',
  serverNameNoAccount: 'Sign in to keep a name on your account.',
  serverNameFailed: "Wren couldn't save the name. Try again.",
  /** The label of the server's address, which is shown and never edited. */
  serverAddress: 'Address',
  serverNote:
    "Name the server anything you like; the name is your account's, so raven and Wren show it on every device you sign in on. The address Wren plays from, with its port, can't be changed here.",
  library: 'Library',
  libraryNote:
    'The music libraries on this server. Home, Search and your collection show the one you pick.',
  appearance: 'Appearance',
  /** What the control that picks the mode sets, said aloud before its choices. */
  themeMode: 'How Wren picks its theme',
  themeModes: {
    [THEME_MODES.system]: 'Match device',
    [THEME_MODES.single]: 'One theme',
  },
  themeModeNotes: {
    [THEME_MODES.system]:
      'Wren switches between two themes as your device goes light or dark. Pick one for each.',
    [THEME_MODES.single]: 'Wren always wears this theme, whether your device is light or dark.',
  },
  /** What the two slots set, said aloud before them. */
  themeSlots: 'The theme to pick',
  /** A slot of the Match device mode: the device's scheme it is worn in. */
  themeSlotNames: {
    [COLOR_SCHEMES.light]: 'When light',
    [COLOR_SCHEMES.dark]: 'When dark',
  },
  /** The slot the device's scheme is showing now. */
  showingNow: 'Showing now',
  /** The heading over the themes, in the One theme mode. */
  theme: 'Theme',
  /** The heading over the themes, for each slot of the Match device mode. */
  themeFor: {
    [COLOR_SCHEMES.light]: 'Theme when light',
    [COLOR_SCHEMES.dark]: 'Theme when dark',
  },
  themeNames: {
    [WREN_THEMES.night]: 'Night',
    [WREN_THEMES.paper]: 'Paper',
    [WREN_THEMES.garnet]: 'Garnet',
    [WREN_THEMES.blush]: 'Blush',
    [WREN_THEMES.mint]: 'Mint',
    [WREN_THEMES.dracula]: 'Dracula',
    [WREN_THEMES.midnight]: 'Midnight',
    [WREN_THEMES.banana]: 'Banana',
    [WREN_THEMES.ember]: 'Ember',
  },
  /** Whether a theme is a light or a dark one, under its name. */
  schemeNames: {
    [COLOR_SCHEMES.light]: 'Light',
    [COLOR_SCHEMES.dark]: 'Dark',
  },
  about: 'About',
  version: 'Version',
  /** Which build this is: "v0.9.0.15". */
  versionOf: (version: string) => `v${version}`,
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

type ResolutionProps = { bitDepth: string; sampleRate: string }

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
  /** Home's albums by when they came out, beside Recently added. */
  latestReleases: 'Latest releases',
  /** What the two orders of Home's albums are chosen under. */
  sortAlbums: 'Sort albums by',
  sorts: { added: 'Date added', release: 'Latest released' },
  /** The date each album's tile shows under the order it is in, so the order can be seen. */
  dates: {
    released: (date: string) => `Released ${date}`,
    added: (date: string) => `Added ${date}`,
    releaseUnknown: 'Release date unknown',
    addedUnknown: 'Date added unknown',
  },
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
  /** raven's music tabs past Playlists, in raven's own words. */
  unmatchedAlbums: 'Unmatched albums',
  inProgress: 'In progress',
  favourites: 'Favourites',
  finished: 'Recently finished',
  downloads: 'Downloads',
  recent: 'Recently added',
  search: 'Search',
  noneYet: 'None yet',
  noAlbums: 'No albums yet.',
  noArtists: 'No artists yet.',
  noSongs: 'No songs yet.',
  noUnmatchedAlbums: 'Every album has a MusicBrainz match.',
  noInProgress: 'Nothing in progress. A song left partway through waits here.',
  noFavourites:
    'No favourites yet. Mark an artist, an album or a song with the heart and it waits here.',
  noFinished: 'Nothing finished yet. A song counts once it plays to its end.',
  noMatches: 'Nothing matches that search.',
  searchAlbums: 'Search albums',
  searchArtists: 'Search artists',
  searchSongs: 'Search songs',
  sortBy: 'Sort by',
  /** The sort button read out: "Sort by, Title". */
  sortLabel: (sort: string) => `Sort by, ${sort}`,
  /** The sheet that picks how large Albums draws its covers, and what each size is called. */
  coverSize: 'Cover size',
  coverSizeLabel: (size: string) => `Cover size, ${size}`,
  coverSizes: {
    extraSmall: 'Extra small',
    small: 'Small',
    medium: 'Medium',
    large: 'Large',
    extraLarge: 'Extra large',
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

/** What a page says when raven holds no music. */
export const LIBRARY_COPY = {
  noMusic: 'raven has no music library yet.',
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

/** What each background option is called, by where it comes from. */
const ARTIST_BACKGROUND_KIND_NAMES = {
  [ARTIST_BACKGROUND_KINDS.photo]: 'Photo',
  [ARTIST_BACKGROUND_KINDS.cover]: 'Album cover',
} as const

type BackgroundOptionProps = { kind: ArtistBackgroundKind; position: number }

export const ARTIST_COPY = {
  opening: 'Opening the artist',
  missing: 'This artist is not on the server.',
  albums: 'Albums',
  appearsOn: 'Appears on',
  /** The owner's button beside Follow, which opens the pictures to pick the background from. */
  editBackground: 'Edit background image',
  backgroundTitle: 'Background image',
  backgroundNote: "Pick the picture behind this artist's name.",
  /** The choice that goes back to the photo raven found for the artist. */
  backgroundDefault: 'Default photo',
  backgroundLoading: 'Finding pictures',
  backgroundFailed: "Couldn't load the pictures. Try again.",
  backgroundEmpty: 'No other pictures were found for this artist.',
  /** Said on the picture in use. */
  backgroundWorn: 'In use',
  /** What each option is called aloud, by where it comes from and its place in the grid. */
  backgroundOption: ({ kind, position }: BackgroundOptionProps) =>
    `${ARTIST_BACKGROUND_KIND_NAMES[kind]} ${position}`,
  /** The head's corner beside the photo: who the artist is. */
  about: 'About the artist',
  birthName: 'Birth name',
  born: 'Born',
  birthplace: 'Birthplace',
  nationality: 'Nationality',
  awards: 'Awards',
  /** Countries or awards on one line: "Canada, United States". */
  listLine: (names: readonly string[]) => names.join(', '),
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

const SOURCE_COPY = {
  /** Where the queue plays from, in one line: "From 1000 Forms Of Fear". */
  from: (name: string) => `From ${name}`,
} as const

export const NOW_PLAYING_COPY = {
  close: 'Close Now Playing',
  /** A lossless file's resolution: "16-bit / 44.1 kHz". */
  resolution: ({ bitDepth, sampleRate }: ResolutionProps) => `${bitDepth} / ${sampleRate}`,
  downloaded: 'Downloaded',
  /** What the quality line is read out as: "Quality, FLAC · 912 kbps". */
  quality: 'Quality',
  more: 'More options',
  /** The button beside the song's name that opens its Add to playlist. */
  addToPlaylist: 'Add to playlist',
  /** What the wide layout's two tabs, Up next and Lyrics, are called aloud. */
  sidePanes: 'Up next or lyrics',
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
  /** Up next's line: "From 1000 Forms Of Fear · 9 songs", or "9 songs" with no source. */
  sourceLine: ({ source, songs }: SourceLineProps) =>
    factsLineOf([source === null ? null : SOURCE_COPY.from(source), songs]),
  /** The Output pill: "raven · This iPhone". */
  output: ({ server, device }: OutputProps) => KIT_COPY.facts([server, `This ${device}`]),
  /** The tablet's output status: "Playing on this iPad". */
  playingOn: (device: string) => `Playing on this ${device}`,
  /** The device Wren plays on, by what it runs on; the web app says the browser it is open in, or the Mac in Wren for Mac. */
  devices: { iPhone: 'iPhone', iPad: 'iPad', android: 'Android', browser: 'browser', mac: 'Mac' },
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

/** What the Apple TV's Top Shelf says above Wren's tile while nobody is signed in; signed in, it is `HOME_COPY.latestReleases`. */
export const TOP_SHELF_COPY = { signIn: 'Sign in to Wren' } as const
