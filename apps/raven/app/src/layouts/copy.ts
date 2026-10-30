import { REPEAT_MODES, type RepeatMode } from '@raven/core'

import type { PersonCard } from '@/queries/itemPage'

/** What the checkbox under a secret field says. */
export const FIELD_COPY = { showPassword: 'Show password', showPin: 'Show PIN' } as const

/** A TV picker's option chosen now, marked with a tick. */
export const PICKER_LIST_COPY = { chosen: (label: string) => `✓ ${label}` } as const

type PersonLabelProps = Pick<PersonCard, 'name' | 'role'>

export const ITEM_LAYOUT_COPY = {
  /** The mark at the end of a version's row, which plays it. */
  play: '▶',
  /** A person as they are read out: "Ana Ruiz, Director". */
  person: ({ name, role }: PersonLabelProps) => `${name}, ${role}`,
  /** A file's fact's values in a list: "English, French". */
  values: (values: readonly string[]) => values.join(', '),
} as const

type NumberedProps = { place: number; title: string }

type ChapterLabelProps = { title: string; at: string }

type PlayTimeProps = { at: string; length: string }

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
  disc: (n: number) => `Disc ${n}`,
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
  /** A playlist's length in whole minutes: "53 min". */
  minutes: (minutes: number) => `${minutes} min`,
  /** Facts on one line: "1997 · 12 tracks · 53:21". */
  facts: (facts: readonly string[]) => facts.join(' · '),
  /** A track as it is read out: "1. Airbag". */
  numbered: ({ place, title }: NumberedProps) => `${place}. ${title}`,
  /** A chapter as it is read out: "Opening, 0:00". */
  chapterLabel: ({ title, at }: ChapterLabelProps) => `${title}, ${at}`,
  /** How far the track has played and how long it is: "1:02 / 4:44". */
  playTime: ({ at, length }: PlayTimeProps) => `${at} / ${length}`,
  appearsOn: 'Appears on',
} as const
