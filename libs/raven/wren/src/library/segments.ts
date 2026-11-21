/** Library's lists, each a category page of its own and named in its path. */
export const LIBRARY_SEGMENTS = {
  albums: 'albums',
  artists: 'artists',
  songs: 'songs',
  playlists: 'playlists',
  downloads: 'downloads',
} as const

export type LibrarySegment = (typeof LIBRARY_SEGMENTS)[keyof typeof LIBRARY_SEGMENTS]
