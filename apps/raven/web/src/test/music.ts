import type {
  AlbumDetails,
  AlbumMatchCandidate,
  AlbumSummary,
  Artist,
  ArtistDetails,
  Track,
} from '@raven/core'

const RADIOHEAD = { id: 1, name: 'Radiohead' } as const

export const album = (overrides: Partial<AlbumSummary> = {}): AlbumSummary => ({
  id: 7,
  libraryId: 3,
  title: 'OK Computer',
  sortTitle: 'OK Computer',
  year: 1997,
  type: 'album',
  artists: [RADIOHEAD],
  isCompilation: false,
  trackCount: 2,
  duration: 400,
  coverVersion: 'cover-v1',
  match: 'matched',
  addedAt: '2026-01-01T00:00:00Z',
  ...overrides,
})

export const track = (overrides: Partial<Track> = {}): Track => ({
  id: 101,
  libraryId: 3,
  albumId: 7,
  title: 'Airbag',
  disc: 1,
  number: 1,
  duration: 200,
  artists: [RADIOHEAD],
  container: 'flac',
  codec: 'flac',
  bitrate: 900000,
  sampleRate: 44100,
  bitDepth: 16,
  isLossless: true,
  mbid: null,
  addedAt: '2026-01-01T00:00:00Z',
  album: { title: 'OK Computer', coverVersion: 'cover-v1' },
  ...overrides,
})

export const albumDetails = (overrides: Partial<AlbumDetails> = {}): AlbumDetails => ({
  album: album(),
  label: 'Parlophone',
  genres: ['Alternative Rock'],
  mbid: '11111111-1111-4111-8111-000000000001',
  discCount: 1,
  tracks: [track(), track({ id: 102, title: 'Paranoid Android', number: 2 })],
  ...overrides,
})

export const artist = (overrides: Partial<Artist> = {}): Artist => ({
  id: RADIOHEAD.id,
  name: RADIOHEAD.name,
  sortName: 'Radiohead',
  mbid: null,
  albumCount: 1,
  trackCount: 2,
  ...overrides,
})

export const artistDetails = (overrides: Partial<ArtistDetails> = {}): ArtistDetails => ({
  artist: artist(),
  albums: [album()],
  appearsOn: [],
  ...overrides,
})

export const albumMatchCandidate = (
  overrides: Partial<AlbumMatchCandidate> = {},
): AlbumMatchCandidate => ({
  mbid: '11111111-1111-4111-8111-000000000002',
  title: 'OK Computer',
  artist: 'Radiohead',
  year: 1997,
  trackCount: 12,
  type: 'album',
  country: 'GB',
  confidence: 95,
  ...overrides,
})
