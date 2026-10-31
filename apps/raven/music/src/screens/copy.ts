import { REPEAT_MODES, type RepeatMode } from '@raven/core'

export const SIGN_IN_COPY = {
  title: 'Wren',
  note: 'Sign in with your raven account to play your music.',
  email: 'Email',
  password: 'Password',
  badAccount: 'Enter your email and password.',
  unreachable: "Couldn't reach raven. Check your connection and try again.",
  pin: 'PIN',
  pinPrompt: 'This server keeps some libraries behind a PIN.',
  adminPassword: 'Admin password',
  adminPrompt:
    "Locked libraries stay hidden on this device until the server's admin password is entered.",
  ticketsOff:
    "This server can't hand out media tickets. Set RAVEN_MEDIA_SECRET on it to play in Wren.",
  notAdded: "raven couldn't be added. Try again.",
  full: 'This device already keeps as many servers as it can.',
  signIn: 'Sign in',
  continue: 'Continue',
  unlock: 'Unlock',
  notNow: 'Not now',
  signOut: 'Sign out',
} as const

export const SETTINGS_COPY = {
  title: 'Settings',
  account: 'Account',
  signedInAs: (email: string) => `Signed in as ${email}`,
  signOut: 'Sign out',
  server: 'Server',
  about: 'About',
  version: (version: string) => `Wren ${version}`,
} as const

export const HOME_COPY = {
  title: 'Home',
  recent: 'Recently added',
  recentIn: (library: string) => `Recently added to ${library}`,
  noAlbums: 'No albums yet.',
} as const

export const LIBRARY_PAGE_COPY = {
  title: 'Library',
  albums: 'Albums',
  artists: 'Artists',
  songs: 'Songs',
  playlists: 'Playlists',
  noAlbums: 'No albums yet.',
  noArtists: 'No artists yet.',
  noSongs: 'No songs yet.',
  noPlaylists: 'No playlists yet. Add a track to one from its menu.',
} as const

/** How an artist's albums and tracks are counted: "3 albums · 41 tracks". */
export const COUNT_COPY = {
  albums: { one: 'album', many: 'albums' },
  tracks: { one: 'track', many: 'tracks' },
  facts: (facts: readonly string[]) => facts.join(' · '),
} as const

export const ALBUM_COPY = {
  opening: 'Opening the album',
  missing: 'This album is not on the server.',
  openArtist: (name: string) => `Go to ${name}`,
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
  empty: (name: string) => `Nothing in ${name} yet. Add songs from any track's menu.`,
} as const

export const SEARCH_COPY = {
  title: 'Search',
  label: 'Search your music',
  hint: 'Find albums, artists and songs in every music library.',
  searching: 'Searching',
  nothing: (query: string) => `Nothing in your music matches "${query}".`,
  albums: 'Albums',
  artists: 'Artists',
  songs: 'Songs',
} as const

type ScrubTextProps = { at: string; length: string }

type QueueEntryLabelProps = { title: string; line: string }

export const NOW_PLAYING_COPY = {
  close: 'Close Now Playing',
  nothing: 'Nothing is playing.',
  position: 'Position',
  volume: 'Volume',
  previous: 'Previous',
  play: 'Play',
  pause: 'Pause',
  next: 'Next',
  shuffle: 'Shuffle',
  speed: 'Speed',
  lyrics: 'Lyrics',
  queue: 'Queue',
  noLyrics: 'No lyrics for this track.',
  instrumental: '♪',
  moveUp: (title: string) => `Move ${title} up`,
  remove: (title: string) => `Remove ${title}`,
  /** A book's speed: "1.25×". */
  speedOf: (speed: number) => `${speed}×`,
  /** Where the scrubber stands, read out: "1:02 of 4:44". */
  scrubText: ({ at, length }: ScrubTextProps) => `${at} of ${length}`,
  /** The volume, read out: "80%". */
  percent: (volume: number) => `${Math.round(volume * 100)}%`,
  /** A queued track as it is read out: "Airbag, Radiohead". */
  entry: ({ title, line }: QueueEntryLabelProps) => `${title}, ${line}`,
  /** What the repeat button says in each mode, which a press moves on from. */
  repeat: {
    [REPEAT_MODES.off]: 'Repeat off',
    [REPEAT_MODES.all]: 'Repeat all',
    [REPEAT_MODES.one]: 'Repeat one',
  } as const satisfies Record<RepeatMode, string>,
} as const
