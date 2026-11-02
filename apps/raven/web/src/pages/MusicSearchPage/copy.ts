export const MUSIC_SEARCH_COPY = {
  title: 'Search',
  searchMusic: 'Search music',
  placeholder: 'Albums, artists and songs',
  hint: 'Search every music library for albums, artists and songs.',
  albums: 'Albums',
  artists: 'Artists',
  songs: 'Songs',
  noAlbums: (query: string) => `No albums match "${query}".`,
  noArtists: (query: string) => `No artists match "${query}".`,
  noSongs: (query: string) => `No songs match "${query}".`,
} as const
