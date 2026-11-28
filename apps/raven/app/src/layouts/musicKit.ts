import {
  type ArtistCredit,
  CROSSFADE_SECONDS,
  type CrossfadeSeconds,
  type FactPart,
  type PlaylistSummary,
  type RepeatMode,
  type AlbumDisc,
  type PlaylistTrack,
  type QueueRow,
  type Track,
} from '@raven/core'
import { AUDIOBOOK_SPEEDS, type AudiobookSpeed } from '@raven/ui/headless'
import type { ReactNode } from 'react'

import { MUSIC_COPY } from '@/layouts/copy'
import type { DownloadButton } from '@/downloads/downloadControl'
import type { ChapterRow, LyricsView } from '@/layouts/musicRows'
import type { Picture } from '@/queries/cards'

/** What the remote and the screen reader call the actions a touch row offers beside a press. */
export const ROW_ACTIONS = { addToPlaylist: 'addToPlaylist' } as const

/** How a track or an album goes to a playlist: one of the account's, or a new one named there. */
export const PLAYLIST_PICKS = { existing: 'existing', fresh: 'fresh' } as const

export type PlaylistPick =
  | { kind: typeof PLAYLIST_PICKS.existing; playlistId: number; name: string }
  | { kind: typeof PLAYLIST_PICKS.fresh; name: string }

/** One of the account's playlists, as Add to playlist offers it. */
export type PlaylistChoice = Pick<PlaylistSummary, 'id' | 'name'>

/** The speeds the picker offers, each keyed by its number in words. */
export const SPEED_OPTIONS = AUDIOBOOK_SPEEDS.map((speed) => ({
  key: String(speed),
  label: MUSIC_COPY.speedLabel(speed),
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

/** The crossfade lengths the picker offers, each keyed by its seconds. */
export const CROSSFADE_OPTIONS = CROSSFADE_SECONDS.map((seconds) => ({
  key: String(seconds),
  label: MUSIC_COPY.crossfadeFor(seconds),
}))

/** What the crossfade picker does with the key chosen: sets the length it names, and nothing for any other. */
export const crossfadeChooserOf =
  (onCrossfade: (seconds: CrossfadeSeconds) => void) =>
  (key: string): void => {
    const seconds = CROSSFADE_SECONDS.find((each) => String(each) === key)
    if (seconds !== undefined) onCrossfade(seconds)
  }

/** What Play or Pause says: what a press does now. */
export const toggleLabelOf = (isPlaying: boolean): string =>
  isPlaying ? MUSIC_COPY.pause : MUSIC_COPY.play

export type AlbumLayoutProps = {
  /** The album's id, whose menu a long press on the cover opens under the thumb. */
  albumId: number
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
  /** Download, which only a touch screen draws. */
  download: DownloadButton
  onBack: () => void
}

/** What the album page's Add to playlist asks: the playlist, and the track or, with null, the album. */
type AlbumPlaylistRequest = { pick: PlaylistPick; index: number | null }

/** What Now Playing shows of the track playing. */
type PlayingTrack = {
  /** The queue's track itself, whose menu a long press on the cover opens under the thumb. */
  played: Track
  title: string
  artists: string
  album: string
  cover: Picture | null
}

/** Whether Now Playing has a track to show. */
export const PLAYING_STATES = { idle: 'idle', playing: 'playing' } as const

export type PlayingState = (typeof PLAYING_STATES)[keyof typeof PLAYING_STATES]

/** Whether `track` is there to show. */
export const playingStateOf = (track: PlayingTrack | null): PlayingState =>
  track === null ? PLAYING_STATES.idle : PLAYING_STATES.playing

export type NowPlayingLayoutProps = {
  /** The track playing, or null when nothing is. */
  track: PlayingTrack | null
  error: string | null
  /** The format and quality of what plays, or null until its source is made. */
  quality: PlayingQuality | null
  /** The playing track's favourite mark, drawn beside its name; nothing while nothing plays. */
  heart: ReactNode
  /** Where the track is, in seconds, for the seek bar. */
  position: number
  /** How long the track is, in seconds, or null until the player knows. */
  duration: number | null
  onSeek: (seconds: number) => void
  isPlaying: boolean
  isShuffled: boolean
  repeat: RepeatMode
  queue: QueueRow[]
  /** How much is queued: "12 tracks · 53:21". */
  queueFacts: string
  onToggle: () => void
  onPrevious: () => void
  onNext: () => void
  onShuffle: () => void
  onRepeat: () => void
  onClear: () => void
  onJump: (place: number) => void
  onRemove: (place: number) => void
  /** What the pane's second tab holds: a book's controls, the lyrics, or nothing yet. */
  aside: NowPlayingAside
  playlists: readonly PlaylistChoice[]
  /** Adds the playing track to the playlist picked. */
  onAddToPlaylist: (pick: PlaylistPick) => void
  note: string | null
  onBack: () => void
}

/**
 * The format and quality of what plays, as every layout draws it: the chips (the format, then
 * a lossless file's bit depth), the rest as one quiet line, and the whole as one sentence.
 */
export type PlayingQuality = {
  chips: FactPart[]
  /** "44.1 kHz · 912 kbps · Downloaded", or null when the chips say it all. */
  facts: string | null
  /** "Playing in FLAC, 16-bit, 44.1 kHz, 912 kbps." */
  label: string
}

/** The two tabs of Now Playing's pane: the queue, and the lyrics or a book's chapters. */
export const PLAYING_PANES = { queue: 'queue', extras: 'extras' } as const

export type PlayingPane = (typeof PLAYING_PANES)[keyof typeof PLAYING_PANES]

/** What the pane's second tab holds. */
export const NOW_PLAYING_ASIDES = { book: 'book', lyrics: 'lyrics', none: 'none' } as const

/**
 * An audiobook's controls, a song's lyrics, or nothing: while nothing plays, or while the
 * lyrics are still being read.
 */
export type NowPlayingAside =
  | { kind: typeof NOW_PLAYING_ASIDES.book; book: BookControls }
  | { kind: typeof NOW_PLAYING_ASIDES.lyrics; lyrics: LyricsView }
  | { kind: typeof NOW_PLAYING_ASIDES.none }

/** What the pane's second tab is called: Chapters for a book, Lyrics for anything else. */
const EXTRAS_LABELS = {
  [NOW_PLAYING_ASIDES.book]: MUSIC_COPY.chapters,
  [NOW_PLAYING_ASIDES.lyrics]: MUSIC_COPY.lyrics,
  [NOW_PLAYING_ASIDES.none]: MUSIC_COPY.lyrics,
} as const satisfies Record<NowPlayingAside['kind'], string>

/** One of the pane's tabs: the pane it shows, and what it is called. */
type PaneTab = { pane: PlayingPane; label: string }

/** The pane's two tabs in their order: Up next, then the lyrics or a book's chapters. */
export const paneTabsOf = (aside: NowPlayingAside): readonly PaneTab[] => [
  { pane: PLAYING_PANES.queue, label: MUSIC_COPY.upNext },
  { pane: PLAYING_PANES.extras, label: EXTRAS_LABELS[aside.kind] },
]

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
  /** Whether it is the account's, and so offers its edits; another account's shared one is read only. */
  isOwn: boolean
  onPlay: () => void
  onShuffle: () => void
  onPlayFrom: (index: number) => void
  onRename: (name: string) => void
  onDelete: () => void
  onMoveUp: (index: number) => void
  onRemove: (index: number) => void
  /** Download, which only a touch screen draws. */
  download: DownloadButton
  onBack: () => void
}

export type NewPlaylistButtonProps = { onCreate: (name: string) => void }

export type FavouriteButtonProps = { isFavourite: boolean; onToggle: () => void }

export type NowPlayingStripProps = {
  /** The track playing, whose menu a long press on the cover opens under the thumb. */
  track: Track
  title: string
  artists: string
  cover: Picture | null
  isPlaying: boolean
  onOpen: () => void
  /** The format and quality of what plays, drawn where there is room: a tablet's strip and a TV's. */
  quality: PlayingQuality | null
  onToggle: () => void
  onNext: () => void
  /** Stops the music and empties the queue, which takes the strip away; the touch strip's X. */
  onClose: () => void
}

/** Which edge of the screen the music strip keeps to while a track plays. */
export const STRIP_EDGES = { top: 'top', bottom: 'bottom' } as const

type StripEdge = (typeof STRIP_EDGES)[keyof typeof STRIP_EDGES]

/** The music pages, which each platform lays out and drives its own way. */
export type MusicKit = {
  /** An album's page: its cover, Play and Shuffle, and its tracks, each playing the album from it. */
  AlbumLayout: (props: AlbumLayoutProps) => ReactNode
  /** Now Playing: the cover large, the controls, and the queue. */
  NowPlayingLayout: (props: NowPlayingLayoutProps) => ReactNode
  /** The strip beside the screens while a track plays, which opens Now Playing. */
  NowPlayingStrip: (props: NowPlayingStripProps) => ReactNode
  /**
   * Where the strip stands: under the screens, by the thumb, or across the top on a TV, fixed
   * however far down a page the remote goes, and reached by going all the way up or all the way left.
   */
  stripEdge: StripEdge
  /** A playlist's page: Play and Shuffle, its tracks, and under the thumb its edits. */
  PlaylistLayout: (props: PlaylistLayoutProps) => ReactNode
  /** The toolbar's way to a new playlist, named as it is made; under the thumb only. */
  NewPlaylistButton: (props: NewPlaylistButtonProps) => ReactNode
  /** A toolbar's favourite mark, as an artist's page wears it. */
  FavouriteButton: (props: FavouriteButtonProps) => ReactNode
}
