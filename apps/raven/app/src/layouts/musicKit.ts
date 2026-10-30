import { type ArtistCredit, type PlaylistSummary, REPEAT_MODES, type RepeatMode } from '@raven/core'
import { AUDIOBOOK_SPEEDS, type AudiobookSpeed } from '@raven/ui/headless'
import type { ReactNode } from 'react'

import type {
  AlbumDisc,
  ChapterRow,
  LyricsView,
  PlaylistTrack,
  QueueRow,
} from '@/layouts/musicRows'
import type { Picture } from '@/queries/cards'

/** The words both platforms' music pages say. */
export const MUSIC_COPY = {
  play: 'Play',
  pause: 'Pause',
  shuffle: 'Shuffle',
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
  instrumental: '\u266A',
  chapters: 'Chapters',
  noChapters: 'This book names no chapters.',
  chapter: (n: number) => `Chapter ${n}`,
  previousChapter: 'Previous chapter',
  nextChapter: 'Next chapter',
  speed: 'Speed',
} as const

/** What the remote and the screen reader call the actions a touch row offers beside a press. */
export const ROW_ACTIONS = { addToPlaylist: 'addToPlaylist' } as const

/** How a track or an album goes to a playlist: one of the account's, or a new one named there. */
export const PLAYLIST_PICKS = { existing: 'existing', fresh: 'fresh' } as const

export type PlaylistPick =
  | { kind: typeof PLAYLIST_PICKS.existing; playlistId: number }
  | { kind: typeof PLAYLIST_PICKS.fresh; name: string }

/** One of the account's playlists, as Add to playlist offers it. */
export type PlaylistChoice = Pick<PlaylistSummary, 'id' | 'name'>

/** A speed as the picker names it: "1.25×". */
const speedLabelOf = (speed: AudiobookSpeed): string => `${speed}\u00D7`

/** The speeds the picker offers, each keyed by its number in words. */
export const SPEED_OPTIONS = AUDIOBOOK_SPEEDS.map((speed) => ({
  key: String(speed),
  label: speedLabelOf(speed),
}))

/** The speed a picker's key names, or null for a key no speed has. */
const speedOfKey = (key: string): AudiobookSpeed | null =>
  AUDIOBOOK_SPEEDS.find((speed) => String(speed) === key) ?? null

/** What the speed picker does with the key chosen: sets the speed it names, and nothing for any other. */
export const speedChooserOf =
  (onSpeed: (speed: AudiobookSpeed) => void) =>
  (key: string): void => {
    const speed = speedOfKey(key)
    if (speed !== null) onSpeed(speed)
  }

/** What the repeat button says in each mode. */
export const REPEAT_LABELS: Record<RepeatMode, string> = {
  [REPEAT_MODES.off]: 'Repeat off',
  [REPEAT_MODES.all]: 'Repeat all',
  [REPEAT_MODES.one]: 'Repeat one',
}

/** What the shuffle button says: "Shuffle on" or "Shuffle off". */
export const shuffleLabelOf = (isShuffled: boolean): string =>
  `${MUSIC_COPY.shuffle} ${isShuffled ? 'on' : 'off'}`

/** What Play or Pause says: what a press does now. */
export const toggleLabelOf = (isPlaying: boolean): string =>
  isPlaying ? MUSIC_COPY.pause : MUSIC_COPY.play

export type AlbumLayoutProps = {
  title: string
  artists: readonly ArtistCredit[]
  /** "1997 · 12 tracks · 53:21". */
  facts: string
  cover: Picture | null
  discs: AlbumDisc[]
  /** The track playing now, to mark its row; null when none of the album's is. */
  playingId: number | null
  onPlay: () => void
  onShuffle: () => void
  onPlayNext: () => void
  onAddToQueue: () => void
  /** Plays the album from the track at `index`. */
  onPlayFrom: (index: number) => void
  onOpenArtist: (artistId: number) => void
  /** Whether the account marked the album a favourite. */
  isFavourite: boolean
  onFavourite: () => void
  /** The account's playlists, which Add to playlist offers under the thumb. */
  playlists: readonly PlaylistChoice[]
  /** Adds the album, or the track at `index` when it names one, to the playlist picked. */
  onAddToPlaylist: (request: AlbumPlaylistRequest) => void
  /** What the last change said, "Added to Mixtape.", or why it failed; null for nothing. */
  note: string | null
  onBack: () => void
}

/** What the album page's Add to playlist asks: the playlist, and the track or, with null, the album. */
type AlbumPlaylistRequest = { pick: PlaylistPick; index: number | null }

/** What Now Playing shows of the track playing. */
type PlayingTrack = {
  title: string
  artists: string
  album: string
  cover: Picture | null
}

export type NowPlayingLayoutProps = {
  /** The track playing, or null when nothing is. */
  track: PlayingTrack | null
  error: string | null
  /** "1:02 / 4:44". */
  time: string
  isPlaying: boolean
  isShuffled: boolean
  repeat: RepeatMode
  queue: QueueRow[]
  onToggle: () => void
  onPrevious: () => void
  onNext: () => void
  onShuffle: () => void
  onRepeat: () => void
  onClear: () => void
  onJump: (place: number) => void
  onRemove: (place: number) => void
  /** What sits below the controls: a book's controls, the lyrics, or nothing yet. */
  aside: NowPlayingAside
  playlists: readonly PlaylistChoice[]
  /** Adds the playing track to the playlist picked. */
  onAddToPlaylist: (pick: PlaylistPick) => void
  note: string | null
  onBack: () => void
}

/** What Now Playing draws below the controls. */
export const NOW_PLAYING_ASIDES = { book: 'book', lyrics: 'lyrics', none: 'none' } as const

/**
 * An audiobook's controls, a song's lyrics, or nothing: while nothing plays, or while the
 * lyrics are still being read.
 */
export type NowPlayingAside =
  | { kind: typeof NOW_PLAYING_ASIDES.book; book: BookControls }
  | { kind: typeof NOW_PLAYING_ASIDES.lyrics; lyrics: LyricsView }
  | { kind: typeof NOW_PLAYING_ASIDES.none }

/** What Now Playing offers an audiobook: its chapters, a press between them, and its speed. */
export type BookControls = {
  chapters: ChapterRow[]
  speed: AudiobookSpeed
  onChapter: (start: number) => void
  onPreviousChapter: () => void
  /** Null in the last chapter, which has none after it. */
  onNextChapter: (() => void) | null
  onSpeed: (speed: AudiobookSpeed) => void
}

export type PlaylistLayoutProps = {
  name: string
  /** "12 tracks · 53 min". */
  facts: string
  tracks: PlaylistTrack[]
  playingId: number | null
  /** Why the last change failed; null for none. */
  note: string | null
  onPlay: () => void
  onShuffle: () => void
  onPlayFrom: (index: number) => void
  onRename: (name: string) => void
  onDelete: () => void
  onMoveUp: (index: number) => void
  onRemove: (index: number) => void
  onBack: () => void
}

export type NewPlaylistButtonProps = { onCreate: (name: string) => void }

export type FavouriteButtonProps = { isFavourite: boolean; onToggle: () => void }

export type NowPlayingStripProps = {
  title: string
  artists: string
  cover: Picture | null
  isPlaying: boolean
  onOpen: () => void
  onToggle: () => void
  onNext: () => void
}

/** The music pages, which each platform lays out and drives its own way. */
export type MusicKit = {
  /** An album's page: its cover, Play and Shuffle, and its tracks, each playing the album from it. */
  AlbumLayout: (props: AlbumLayoutProps) => ReactNode
  /** Now Playing: the cover large, the controls, and the queue. */
  NowPlayingLayout: (props: NowPlayingLayoutProps) => ReactNode
  /** The strip under the screens while a track plays, which opens Now Playing. */
  NowPlayingStrip: (props: NowPlayingStripProps) => ReactNode
  /** A playlist's page: Play and Shuffle, its tracks, and under the thumb its edits. */
  PlaylistLayout: (props: PlaylistLayoutProps) => ReactNode
  /** The toolbar's way to a new playlist, named as it is made; under the thumb only. */
  NewPlaylistButton: (props: NewPlaylistButtonProps) => ReactNode
  /** A toolbar's favourite mark, as an artist's page wears it. */
  FavouriteButton: (props: FavouriteButtonProps) => ReactNode
}
