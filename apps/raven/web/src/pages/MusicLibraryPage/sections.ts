/** The library's five lists, each at its own address. */
export const MUSIC_LIBRARY_SECTIONS = {
  albums: 'albums',
  artists: 'artists',
  noArtwork: 'no-artwork',
  songs: 'songs',
  playlists: 'playlists',
} as const

export type MusicLibrarySection =
  (typeof MUSIC_LIBRARY_SECTIONS)[keyof typeof MUSIC_LIBRARY_SECTIONS]
