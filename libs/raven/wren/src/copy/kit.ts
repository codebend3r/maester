import { REPEAT_MODES, type RepeatMode } from '@raven/core'

type TitledProps = { title: string; artists: string }

type ScrubTextProps = { at: string; length: string }

type LabelledProps = { label: string; value: string }

type TabLabelProps = { label: string; at: number; count: number }

type PartOfProps = { done: number; total: number }

/** The words the shared kit says, on screen and aloud. */
export const KIT_COPY = {
  loading: 'Loading',
  close: 'Close',
  cancel: 'Cancel',
  clearSearch: 'Clear search',
  seeAll: 'See all',
  /** See all, named for its section: "See all, Recently added". */
  seeAllOf: (title: string) => `See all, ${title}`,
  /** A row read out with what it is set to: "Storage limit, Off", "OK Computer, Radiohead". */
  labelled: ({ label, value }: LabelledProps) => `${label}, ${value}`,
  /** Facts on one line, the one joiner every line of facts uses: "Pop · 2014 · 20 songs". */
  facts: (facts: readonly string[]) => facts.join(' · '),
  searchPlaceholder: 'Artists, albums, songs',
  search: 'Search',
  more: (title: string) => `More for ${title}`,
  downloaded: 'Downloaded',
  /** A back link names the page it returns to: "< Library". */
  back: (to: string) => `Back to ${to}`,
  /** The way back where the page it returns to goes unnamed. */
  backAlone: 'Back',
} as const

/** The key that collapses or expands the web's sidebar, as the web app's own side menu does. */
export const SIDEBAR_KEY = 'b'

/** The sidebar's key as a keyboard names it. */
const SIDEBAR_KEY_NAME = SIDEBAR_KEY.toUpperCase()

/** The web's sidebar and the key that folds it to its icons. */
export const SIDEBAR_COPY = {
  name: 'Side menu',
  /** The key that collapses or expands it, as a keyboard names it. */
  key: SIDEBAR_KEY_NAME,
  collapse: `Collapse the side menu (${SIDEBAR_KEY_NAME})`,
  expand: `Expand the side menu (${SIDEBAR_KEY_NAME})`,
} as const

/** Facts on one line, each one missing or empty left out: "Pop · 2014 · 20 songs". */
export const factsLineOf = (facts: readonly (string | null)[]): string =>
  KIT_COPY.facts(facts.filter((fact): fact is string => fact !== null && fact !== ''))

/** How albums, artists, songs, tracks and playlists are counted: "3 albums · 41 tracks". */
export const COUNTS_COPY = {
  albums: { one: 'album', many: 'albums' },
  artists: { one: 'artist', many: 'artists' },
  tracks: { one: 'track', many: 'tracks' },
  songs: { one: 'song', many: 'songs' },
  playlists: { one: 'playlist', many: 'playlists' },
  /** A count past the most a list shows: "48+". */
  orMore: (most: string) => `${most}+`,
  /** Part of an album downloaded: "1 of 20 tracks". */
  partOf: ({ done, total }: PartOfProps) => `${done} of ${total} tracks`,
} as const

/** The server chip's words, its state said as well as drawn: "raven · connected". */
export const STATUS_COPY = {
  /** The server's name where nothing configures one: the web app, which talks to its own origin. */
  raven: 'raven',
  connected: (name: string) => KIT_COPY.facts([name, 'connected']),
  unreachable: (name: string) => KIT_COPY.facts([name, 'unreachable']),
} as const

/** The player's words, wherever a control plays, steps or opens what plays. */
export const PLAYER_COPY = {
  play: 'Play',
  pause: 'Pause',
  next: 'Next',
  previous: 'Previous',
  shuffle: 'Shuffle',
  /** What the repeat button says in each mode, which a press moves on from. */
  repeat: {
    [REPEAT_MODES.off]: 'Repeat off',
    [REPEAT_MODES.all]: 'Repeat all',
    [REPEAT_MODES.one]: 'Repeat one',
  } as const satisfies Record<RepeatMode, string>,
  like: 'Like',
  follow: 'Follow',
  queue: 'Queue',
  lyrics: 'Lyrics',
  upNext: 'Up next',
  output: 'Output',
  position: 'Playback position',
  volume: 'Volume',
  /** The speaker beside the web's volume line, named for what a press does. */
  mute: 'Mute',
  unmute: 'Unmute',
  speed: 'Speed',
  /** Where the scrubber stands, read out: "1:02 of 4:44". */
  scrubText: ({ at, length }: ScrubTextProps) => `${at} of ${length}`,
  /** What the mini player is called aloud: what it opens, and the track it shows. */
  open: ({ title, artists }: TitledProps) => `Now Playing: ${title}, ${artists}`,
} as const

/** The words of the form that makes a playlist, wherever it shows. */
export const NEW_PLAYLIST_COPY = {
  title: 'New playlist',
  name: 'Playlist name',
  placeholder: 'My playlist',
  create: 'Create',
} as const

/** The tab bar's words. */
export const TAB_COPY = {
  /** A tab as iOS reads one out: "Library, tab, 2 of 4". */
  label: ({ label, at, count }: TabLabelProps) => `${label}, tab, ${at + 1} of ${count}`,
} as const
