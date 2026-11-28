import type { AppPath } from '@raven/core'

/**
 * The music mode's pages, under `/music`: Home, the library's four lists,
 * the album, artist and playlist pages raven's own mode shows too, a mix,
 * Now Playing, the music search and, in Raven, the downloads.
 */
export const MUSIC_PATHS = {
  root: '/music',
  albums: '/music/albums',
  artists: '/music/artists',
  noArtwork: '/music/no-artwork',
  songs: '/music/songs',
  playlists: '/music/playlists',
  album: '/music/albums/:id',
  artist: '/music/artists/:id',
  playlist: '/music/playlists/:id',
  mix: '/music/mixes/:id',
  nowPlaying: '/music/now-playing',
  search: '/music/search',
  downloads: '/music/downloads',
} as const satisfies Record<string, AppPath>
