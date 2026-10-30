type LibraryLineProps = { kind: string; count: string }

/** A music library's line under its name: "Music, 12 albums". */
const libraryLine = ({ kind, count }: LibraryLineProps) => `${kind}, ${count}`

export const ALBUMS_GRID_COPY = {
  search: (library: string) => `Search ${library}`,
  gathering: 'Gathering the albums',
  none: 'No albums here yet. A scan files each audio file under its album as it reads its tags.',
  noMatch: (query: string) => `No album matches "${query}".`,
  line: libraryLine,
} as const

export const ARTISTS_GRID_COPY = {
  search: (library: string) => `Search artists in ${library}`,
  gathering: 'Gathering the artists',
  none: 'No artists here yet. A scan credits each artist its tags name.',
  noMatch: (query: string) => `No artist matches "${query}".`,
  line: libraryLine,
} as const

export const PLAYLISTS_GRID_COPY = {
  gathering: 'Gathering your playlists',
  none: 'You have no playlists yet. Make one here, or add tracks to one from an album.',
} as const

export const MUSIC_PAGES_COPY = {
  show: (page: string) => `Show ${page}`,
  albums: 'Albums',
  artists: 'Artists',
  playlists: 'Playlists',
} as const
