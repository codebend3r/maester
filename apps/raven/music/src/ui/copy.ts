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

/** How albums, artists, songs, tracks and playlists are counted: "3 albums · 41 tracks". */
export const COUNTS_COPY = {
  albums: { one: 'album', many: 'albums' },
  artists: { one: 'artist', many: 'artists' },
  tracks: { one: 'track', many: 'tracks' },
  songs: { one: 'song', many: 'songs' },
  playlists: { one: 'playlist', many: 'playlists' },
  /** Part of an album downloaded: "1 of 20 tracks". */
  partOf: ({ done, total }: PartOfProps) => `${done} of ${total} tracks`,
} as const

/** The server chip's words, its state said as well as drawn: "raven · connected". */
export const STATUS_COPY = {
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
  speed: 'Speed',
  /** Where the scrubber stands, read out: "1:02 of 4:44". */
  scrubText: ({ at, length }: ScrubTextProps) => `${at} of ${length}`,
  /** How long is left, as the scrubber's right end says it: "-1:09". */
  remaining: (left: string) => `-${left}`,
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
