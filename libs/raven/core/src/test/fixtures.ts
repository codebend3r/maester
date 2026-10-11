import type { CanPlay } from '@/playback'
import type { ItemDetails, ItemSummary, Library, MediaItem, Review, ShowEntry } from '@/types'

export const library = (overrides: Partial<Library> = {}): Library => ({
  id: 1,
  name: 'Movies',
  paths: ['/media/movies'],
  itemCount: 0,
  createdAt: '2026-09-27T00:00:00.000Z',
  scan: {
    state: 'idle',
    discovered: 0,
    processed: 0,
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
  },
  ...overrides,
})

export const mediaItem = (overrides: Partial<MediaItem> = {}): MediaItem => ({
  id: 1,
  libraryId: 1,
  title: 'Sample',
  fileName: 'Sample.mp4',
  folder: '',
  size: 1_000_000,
  container: 'mp4',
  duration: 120,
  width: 1920,
  height: 1080,
  videoCodec: 'h264',
  videoBitDepth: 8,
  hdr: false,
  audioCodec: 'aac',
  audioChannels: 2,
  bitrate: 5_000_000,
  thumbnail: 'ready',
  thumbnailVersion: 1,
  position: 0,
  favourite: false,
  addedAt: '2026-09-27T00:00:00.000Z',
  match: 'off',
  year: null,
  edition: null,
  item: null,
  versions: 1,
  ...overrides,
})

export const itemSummary = (overrides: Partial<ItemSummary> = {}): ItemSummary => ({
  id: 1,
  type: 'movie',
  title: 'The Matrix',
  year: 1999,
  show: null,
  season: null,
  episode: null,
  posterVersion: 'f89JxwBCi9N',
  ratings: [{ source: 'tmdb', kind: 'audience', value: 8.2, votes: 26_000 }],
  ...overrides,
})

export const showEntry = (overrides: Partial<ShowEntry> = {}): ShowEntry => ({
  show: itemSummary({ id: 4, type: 'show', title: 'Severance', year: 2022 }),
  episodes: 9,
  endedYear: null,
  addedAt: '2026-09-27T00:00:00.000Z',
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
    }),
  }),
  ...overrides,
})

export const itemDetails = (overrides: Partial<ItemDetails> = {}): ItemDetails => ({
  ...itemSummary(),
  tmdbId: '603',
  imdbId: 'tt0133093',
  originalTitle: 'The Matrix',
  tagline: 'Welcome to the Real World.',
  summary: 'Set in the 22nd century, The Matrix tells the story of a computer hacker.',
  contentRating: 'R',
  released: '1999-03-31',
  ended: null,
  runtime: 136,
  studio: 'Warner Bros. Pictures',
  genres: ['Action', 'Science Fiction'],
  backdropVersion: 'tlm8UkiQsit',
  reviews: [],
  credits: [
    { personId: 1, name: 'Keanu Reeves', job: 'cast', role: 'Neo', photoVersion: 'abc' },
    { personId: 2, name: 'Lana Wachowski', job: 'director', role: 'Director', photoVersion: null },
  ],
  versions: [mediaItem({ match: 'matched', year: 1999, item: itemSummary() })],
  children: [],
  ...overrides,
})

/**
 * A stand-in for `canPlayType`: plays any MIME type whose container and
 * every listed codec appear in `supports`.
 */
export const canPlayFrom =
  (supports: readonly string[]): CanPlay =>
  (mimeType) => {
    const [container = '', params = ''] = mimeType.split(';')
    const codecs = /codecs="([^"]*)"/.exec(params)?.[1]?.split(',') ?? []
    return (
      supports.includes(container.trim()) &&
      codecs.every((codec) => supports.includes(codec.trim()))
    )
  }

/** What desktop Chrome on a Mac answered: Matroska and HEVC yes, Dolby and DTS audio no. */
export const chromeLike = canPlayFrom([
  'video/mp4',
  'video/webm',
  'video/x-matroska',
  'avc1.640028',
  'avc1.6E0028',
  'hvc1.1.6.L150.B0',
  'hvc1.2.4.L153.B0',
  'vp09.00.51.08',
  'vp09.02.51.10',
  'av01.0.08M.08',
  'av01.0.12M.10',
  'mp4a.40.2',
  'mp4a.6B',
  'opus',
  'flac',
  'vorbis',
])

/** Safari: no Matroska at all, but Dolby audio is fine. */
export const safariLike = canPlayFrom([
  'video/mp4',
  'avc1.640028',
  'hvc1.1.6.L150.B0',
  'hvc1.2.4.L153.B0',
  'mp4a.40.2',
  'ac-3',
  'ec-3',
])

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
