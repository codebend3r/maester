import type { ItemDetails, ItemSummary, Library, MediaItem, Review, ShowEntry } from '@raven/core'

export const library = (overrides: Partial<Library> = {}): Library => ({
  id: 2,
  name: 'Movies',
  paths: ['/media/Movies'],
  itemCount: 12,
  unmatchedCount: 0,
  createdAt: '2026-09-27T00:00:00.000Z',
  scan: {
    state: 'idle',
    found: 12,
    processed: 12,
    startedAt: null,
    finishedAt: null,
    error: null,
  },
  settings: {
    saveProgress: true,
    pinned: true,
    sort: 'title',
    view: 'grid',
    groupBy: 'resolution',
    watchedPercent: 90,
    kind: 'other',
    ratingsSource: 'tmdb',
    autoRefresh: true,
    locked: false,
  },
  backdrop: null,
  ...overrides,
})

export const mediaItem = (overrides: Partial<MediaItem> = {}): MediaItem => ({
  id: 7,
  libraryId: 2,
  title: 'Busboys (2026)',
  fileName: 'Busboys (2026) 1080p WEBRip.mkv',
  folder: '',
  size: 1_609_721_462,
  container: 'mkv',
  duration: 5812.768,
  width: 1920,
  height: 1038,
  videoCodec: 'hevc',
  videoBitDepth: 10,
  hdr: false,
  audioCodec: 'aac',
  audioChannels: 6,
  bitrate: 2_215_000,
  thumbnail: 'ready',
  thumbnailVersion: 1,
  position: 0,
  favourite: false,
  addedAt: '2026-09-27T00:00:00.000Z',
  changedAt: '2026-09-27T00:00:00.000Z',
  match: 'off',
  year: null,
  edition: null,
  item: null,
  versions: 1,
  variant: null,
  ...overrides,
})

export const itemSummary = (overrides: Partial<ItemSummary> = {}): ItemSummary => ({
  id: 40,
  type: 'movie',
  title: 'Busboys',
  year: 2026,
  show: null,
  season: null,
  episode: null,
  posterVersion: 'p1',
  backdropVersion: null,
  ratings: [{ source: 'tmdb', kind: 'audience', value: 8.2, votes: 1200 }],
  ...overrides,
})

/** A matched movie in a Movies library: the file's parsed name, and the movie it is. */
export const matchedMovie = (overrides: Partial<MediaItem> = {}): MediaItem =>
  mediaItem({ title: 'Busboys', year: 2026, match: 'matched', item: itemSummary(), ...overrides })

export const itemDetails = (overrides: Partial<ItemDetails> = {}): ItemDetails => ({
  ...itemSummary(),
  tmdbId: '1001',
  imdbId: 'tt1001',
  originalTitle: 'Busboys',
  tagline: 'Every table has a story.',
  summary: 'Two busboys at a downtown steakhouse plan one last perfect shift.',
  contentRating: 'R',
  released: '2026-03-14',
  ended: null,
  runtime: 97,
  studio: 'Night Shift Pictures',
  genres: ['Comedy', 'Drama', 'Crime', 'Romance'],
  backdropVersion: 'b1',
  logoVersion: null,
  reviews: [],
  credits: [
    { personId: 1, name: 'Mark Kimball', job: 'cast', role: 'Rudy', photoVersion: 'k1' },
    { personId: 2, name: 'Ana Ortiz', job: 'cast', role: 'Lena', photoVersion: null },
    { personId: 1, name: 'Mark Kimball', job: 'director', role: 'Director', photoVersion: 'k1' },
    { personId: 3, name: 'Jo Park', job: 'writer', role: 'Screenplay', photoVersion: null },
  ],
  versions: [matchedMovie()],
  children: [],
  ...overrides,
})

export const showEntry = (overrides: Partial<ShowEntry> = {}): ShowEntry => ({
  show: itemSummary({ id: 4, type: 'show', title: 'Severance', year: 2022, posterVersion: 'p1' }),
  episodes: 9,
  endedYear: null,
  addedAt: '2026-09-27T00:00:00.000Z',
  bitrate: 6_000_000,
  next: mediaItem({
    id: 12,
    title: 'Severance - S01E02 - Half Loop',
    match: 'matched',
    item: itemSummary({
      id: 6,
      type: 'episode',
      title: 'Half Loop',
      year: 2022,
      show: { id: 4, title: 'Severance' },
      season: 1,
      episode: 2,
      posterVersion: null,
    }),
  }),
  ...overrides,
})

export const review = (overrides: Partial<Review> = {}): Review => ({
  id: 1,
  author: 'A TMDB member',
  avatarVersion: null,
  rating: 8,
  content: 'A fine film, if a little long.',
  url: 'https://www.themoviedb.org/review/abc',
  writtenAt: '2026-10-01T12:00:00.000Z',
  ...overrides,
})
