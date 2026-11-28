import type { MusicFactKey } from '@raven/core'

import { KIT_COPY } from '@/copy/kit'

/** The brand's name, as the lockup is read out. */
export const WREN_LOCKUP_COPY = {
  name: 'Wren',
} as const

type PlaylistRowLabelProps = { name: string; count: string }

/** What a track's sheet and the Add to playlist sheet say. */
export const TRACK_MENU_COPY = {
  /** A song's favourite, which the menu's first row and the row's heart turn on and off. */
  like: 'Like',
  unlike: 'Unlike',
  /** The row's heart, read out with the song: "Like Airbag". */
  likeSong: (title: string) => `Like ${title}`,
  playNext: 'Play next',
  addToQueue: 'Add to queue',
  addToPlaylist: 'Add to playlist…',
  goToAlbum: 'Go to album',
  goToArtist: 'Go to artist',
  /** The Add to playlist sheet's title. */
  addToPlaylistTitle: 'Add to playlist',
  /** What the list of playlists is called aloud: "Add Airbag to a playlist". */
  pickPlaylist: (title: string) => `Add ${title} to a playlist`,
  added: (name: string) => `Added to ${name}`,
  noPlaylists: "You don't have any playlists",
  noPlaylistsHint: (title: string) => `Create one and ${title} goes straight in.`,
  loading: 'Loading your playlists',
  /** A playlist row as it is read out: "Mixtape, 2 songs". */
  playlistRow: ({ name, count }: PlaylistRowLabelProps) =>
    count === '' ? name : KIT_COPY.labelled({ label: name, value: count }),
} as const

/** What each fact of a held cover's menu is called beside its value. */
export const COVER_FACT_LABELS = {
  artists: 'Artist',
  album: 'Album',
  released: 'Released',
  kind: 'Type',
  genres: 'Genre',
  label: 'Label',
  tracks: 'Songs',
  length: 'Length',
  quality: 'Quality',
  format: 'Format',
  plays: 'Plays',
} as const satisfies Record<MusicFactKey, string>

/** How the menu a held cover opens is told aloud. */
export const COVER_MENU_COPY = {
  /** What Now Playing's cover is called aloud: "Cover of Airbag". */
  cover: (title: string) => `Cover of ${title}`,
  /** The name of a cover's long press in the screen reader's list of actions. */
  holdAction: 'More about it',
  /** The screen reader's hint for a cover that holds its menu. */
  holdHint: 'Hold for more about it, and to go to its album or artist',
} as const

type DownloadingProps = { done: number; total: number }

/** What an album's or a playlist's download button says in each state. */
export const DOWNLOAD_BUTTON_COPY = {
  download: 'Download',
  downloading: ({ done, total }: DownloadingProps) => `Downloading ${done} of ${total}`,
  /** The short label under the progress ring: "2 of 3". */
  progress: ({ done, total }: DownloadingProps) => `${done} of ${total}`,
  downloaded: 'Downloaded',
  remove: 'Remove download',
  retry: 'Retry download',
  /** The short label under the icon while a download failed. */
  retryShort: 'Retry',
} as const

/** What Wren says when a download cannot start. */
export const DOWNLOAD_COPY = {
  full: (limitGb: number) =>
    `Downloads would pass the ${limitGb} GB limit. Remove some, or raise the limit in Settings.`,
  unreachable: 'The server this track is on is not signed in.',
} as const
