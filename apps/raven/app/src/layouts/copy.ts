import { RATING_SOURCES, REPEAT_MODES, type RepeatMode } from '@raven/core'

import type { PersonCard } from '@/queries/itemPage'

/** The name every form wears above its own title, always in the display font. */
export const FORM_COPY = { wordmark: 'Raven' } as const

/** The way back to Home every screen but Home, sign-in and the player wears at its top left. */
export const HOME_NAV_COPY = { home: 'Home' } as const

/** The TV grid's size picker, and what each size is called. */
export const GRID_SIZE_COPY = {
  label: 'Size',
  sizes: { small: 'Small', medium: 'Medium', large: 'Large' },
} as const

/** The side menus' way to every library on the server, pinned or not, and that screen's title. */
export const LIBRARIES_ENTRY = { label: 'Libraries' } as const

/** What the checkbox under a secret field says. */
export const FIELD_COPY = { showPassword: 'Show password' } as const

/** A TV picker's option chosen now, marked with a tick. */
export const PICKER_LIST_COPY = { chosen: (label: string) => `✓ ${label}` } as const

type RatingSaidProps = { site: string; score: string; spoken: string; meaning: string }

/** The ratings panel's words, the web's: each source's full name, the label under its score, what the number means and its scale. */
export const RATING_PANEL_COPY = {
  ratings: 'Ratings',
  sources: {
    [RATING_SOURCES.rottenTomatoes]: {
      site: 'Rotten Tomatoes',
      label: 'Tomatometer',
      meaning: 'Critics who reviewed it positively',
      shown: '%',
      spoken: '%',
    },
    [RATING_SOURCES.imdb]: {
      site: 'IMDb',
      label: 'IMDb',
      meaning: 'Average user rating',
      shown: '/10',
      spoken: ' out of 10',
    },
    [RATING_SOURCES.metacritic]: {
      site: 'Metacritic',
      label: 'Metascore',
      meaning: 'Weighted critic score',
      shown: '/100',
      spoken: ' out of 100',
    },
    [RATING_SOURCES.tmdb]: {
      site: 'TMDB',
      label: 'TMDB',
      meaning: 'Average user rating',
      shown: '/10',
      spoken: ' out of 10',
    },
  },
  /** One score as it is read out: "Rotten Tomatoes: 72%. Critics who reviewed it positively." */
  itemLabel: ({ site, score, spoken, meaning }: RatingSaidProps) =>
    `${site}: ${score}${spoken}. ${meaning}.`,
} as const

type PersonLabelProps = Pick<PersonCard, 'name' | 'role'>

export const ITEM_LAYOUT_COPY = {
  /** The mark at the end of a version's row, which plays it. */
  play: '▶',
  /** The show's title art or name over an episode or a season, pressed to go back to the show's page; apart from the links row's "Go to". */
  backTo: (name: string) => `Back to ${name}`,
  /** A person as they are read out: "Ana Ruiz, Director". */
  person: ({ name, role }: PersonLabelProps) => `${name}, ${role}`,
  /** A file's fact's values in a list: "English, French". */
  values: (values: readonly string[]) => values.join(', '),
} as const

/** What a screen reader says of a chip of the picture's: "Video resolution: 4K". */
export const FACT_CHIP_COPY = {
  videoResolution: (resolution: string) => `Video resolution: ${resolution}`,
  videoCodec: (codec: string) => `Video codec: ${codec}`,
} as const

type ChapterLabelProps = { title: string; at: string }

/** The words both platforms' music pages say. */
export const MUSIC_COPY = {
  play: 'Play',
  pause: 'Pause',
  shuffle: 'Shuffle',
  shuffleOn: 'Shuffle on',
  shuffleOff: 'Shuffle off',
  repeat: {
    [REPEAT_MODES.off]: 'Repeat off',
    [REPEAT_MODES.all]: 'Repeat all',
    [REPEAT_MODES.one]: 'Repeat one',
  } as const satisfies Record<RepeatMode, string>,
  playNext: 'Play next',
  addToQueue: 'Add to queue',
  previous: 'Previous',
  next: 'Next',
  nowPlaying: 'Now Playing',
  nothingPlaying: 'Nothing is playing.',
  upNext: 'Up next',
  clear: 'Clear',
  remove: 'Remove',
  removeTrack: (title: string) => `Remove ${title}`,
  openNowPlaying: 'Open Now Playing',
  goTo: (name: string) => `Go to ${name}`,
  favourite: 'Favourite',
  playlist: 'Playlist',
  newPlaylist: 'New playlist',
  create: 'Make',
  rename: 'Rename',
  renamePlaylist: 'Rename playlist',
  delete: 'Delete',
  deletePlaylist: (name: string) => `Delete ${name}?`,
  deleteNote: 'Its tracks stay in the library.',
  addToPlaylist: 'Add to playlist',
  addTrackToPlaylist: (title: string) => `Add ${title} to a playlist`,
  added: (playlist: string) => `Added to ${playlist}.`,
  up: 'Up',
  moveUp: (title: string) => `Move ${title} up`,
  removeFrom: (title: string) => `Remove ${title} from the playlist`,
  emptyPlaylist: (name: string) =>
    `Nothing in ${name} yet. Add tracks from an album, or from Now Playing.`,
  lyrics: 'Lyrics',
  noLyrics: 'No lyrics for this track.',
  /** The lyrics column on a TV: select makes it large, select again small. */
  lyricsEnlarge: 'Lyrics. Select to make them larger',
  lyricsShrink: 'Lyrics. Select to make them smaller',
  crossfade: 'Crossfade',
  /** A crossfade length as the picker names it: "Off", "12 seconds". */
  crossfadeFor: (seconds: number) => (seconds === 0 ? 'Off' : `${seconds} seconds`),
  /** The cover with the equalizer over it: what a select does. */
  coverEqualizerOn: 'Album cover, with the equalizer. Select to hide the equalizer',
  coverEqualizerOff: 'Album cover. Select to show the equalizer',
  /** The equalizer in a cover's place, for a track with no artwork. */
  equalizerOn: 'The equalizer. Select to hide it',
  equalizerOff: 'No album cover. Select to show the equalizer',
  instrumental: '♪',
  chapters: 'Chapters',
  noChapters: 'This book names no chapters.',
  chapter: (n: number) => `Chapter ${n}`,
  previousChapter: 'Previous chapter',
  nextChapter: 'Next chapter',
  speed: 'Speed',
  /** A speed as the picker names it: "1.25×". */
  speedLabel: (speed: number) => `${speed}×`,
  tracks: { one: 'track', many: 'tracks' },
  albums: { one: 'album', many: 'albums' },
  artists: { one: 'artist', many: 'artists' },
  playlists: { one: 'playlist', many: 'playlists' },
  /** Facts on one line: "1997 · 12 tracks · 53:21". */
  facts: (facts: readonly string[]) => facts.join(' · '),
  /** A chapter as it is read out: "Opening, 0:00". */
  chapterLabel: ({ title, at }: ChapterLabelProps) => `${title}, ${at}`,
  appearsOn: 'Appears on',
} as const

/** What stands where a locked library's videos would be, as the web's `LockedLibrary` says it. */
export const LOCKED_LIBRARY_COPY = {
  locked: 'Locked',
  isLocked: (name: string) => `${name} is locked.`,
  unlock: 'Unlock',
  /** A locked library's row in a side menu, as it is read out. */
  lockedRow: (name: string) => `${name}, locked`,
} as const

/** The PIN pad, in the web's `PinPadDialog`'s words. */
export const PIN_PAD_COPY = {
  title: 'Unlock libraries',
  hint: 'Enter the PIN to open the locked libraries on this device.',
  pad: 'PIN pad',
  empty: 'Enter the PIN',
  dot: '●',
  entered: (count: number) => (count === 1 ? '1 digit entered' : `${count} digits entered`),
  backspace: 'Delete the last digit',
  unlock: 'Unlock',
  cancel: 'Cancel',
} as const
