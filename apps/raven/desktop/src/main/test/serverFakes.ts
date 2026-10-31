import type {
  AlbumDetails,
  EpisodeSummary,
  ItemDetails,
  ItemSummary,
  Library,
  MediaItem,
  PlaylistDetails,
  SeasonSummary,
  Track,
} from '@raven/core'
import { RATINGS_REFRESH_STATES } from '@raven/core'
import { requestFor, type AllowedCall } from '@/main/servers/allowlist'
import type { ServerCalls } from '@/main/servers/serverCalls'

/** What the fake server answers one call: a status and a body, or no answer at all. */
export type Reply = { status: number; body: unknown } | { unreachable: string }

export const keyOf = (call: AllowedCall): string => {
  const { method, path } = requestFor(call)
  return `${method} ${path}`
}

export const ok = (body: unknown): Reply => ({ status: 200, body })

/**
 * Server calls answered from `replies`, keyed by `keyOf`; a call it has no reply for is a 404.
 * The table is read at each call, so a test can change what the server answers between calls.
 */
export const fakeCalls = (replies: Record<string, Reply>) => {
  const log: string[] = []
  const calls: Pick<ServerCalls, 'call'> = {
    call: async ({ call }) => {
      const key = keyOf(call)
      log.push(key)
      const reply = replies[key] ?? { status: 404, body: '' }
      if ('unreachable' in reply) return { ok: false, message: reply.unreachable }
      const body = typeof reply.body === 'string' ? reply.body : JSON.stringify(reply.body)
      return { ok: true, status: reply.status, body }
    },
  }
  return { calls, log }
}

export const summary = (overrides: Partial<ItemSummary>): ItemSummary => ({
  id: 1,
  type: 'movie',
  title: 'Fellowship',
  year: 2001,
  show: null,
  season: null,
  episode: null,
  posterVersion: null,
  backdropVersion: null,
  ratings: [],
  released: null,
  ...overrides,
})

export const details = (overrides: Partial<ItemDetails>): ItemDetails => ({
  ...summary({}),
  tmdbId: '120',
  imdbId: null,
  originalTitle: null,
  tagline: null,
  summary: null,
  contentRating: null,
  released: null,
  ended: null,
  runtime: null,
  studio: null,
  genres: [],
  logoVersion: null,
  favourite: null,
  aiMatch: null,
  credits: [],
  reviews: [],
  versions: [],
  children: [],
  libraryPictures: [],
  ...overrides,
})

type LibraryProps = { id: number; watchedPercent: number }

export const library = (overrides: LibraryProps): Library => ({
  id: overrides.id,
  name: 'Library',
  paths: [],
  layouts: [],
  itemCount: 0,
  unmatchedCount: 0,
  createdAt: '2026-10-16T00:00:00.000Z',
  scan: {
    state: 'idle',
    kind: 'full',
    found: 0,
    processed: 0,
    startedAt: null,
    finishedAt: null,
    quickScannedAt: null,
    error: null,
  },
  settings: {
    saveProgress: true,
    pinned: true,
    inHero: true,
    sort: 'title',
    view: 'grid',
    groupBy: 'resolution',
    watchedPercent: overrides.watchedPercent,
    kind: 'other',
    ratingsSource: 'tmdb',
    autoRefresh: true,
    locked: false,
    folderLayout: 'auto',
    icon: null,
  },
  backdrop: null,
  ratingsRefresh: { state: RATINGS_REFRESH_STATES.idle, finishedAt: null },
})

export const show = { id: 4, title: 'Severance' }

type EpisodeProps = {
  id: number
  season: number
  number: number
  title: string
  primary: MediaItem | null
}

export const episode = ({ id, season, number, title, primary }: EpisodeProps): EpisodeSummary => ({
  ...summary({ id, type: 'episode', title, show, season, episode: number }),
  type: 'episode',
  summary: null,
  released: null,
  runtime: null,
  stillVersion: null,
  watched: false,
  primary,
})

type SeasonProps = { id: number; number: number }

export const season = ({ id, number }: SeasonProps): SeasonSummary => ({
  ...summary({ id, type: 'season', title: `Season ${number}`, show, season: number }),
  type: 'season',
  episodeCount: 2,
  watchedCount: 0,
})

const RADIOHEAD = { id: 1, name: 'Radiohead' }

/** A FLAC track of OK Computer, album 7 in music library 3. */
export const track = (overrides: Partial<Track>): Track => ({
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
  bitrate: 900_000,
  sampleRate: 44_100,
  bitDepth: 16,
  isLossless: true,
  mbid: null,
  addedAt: '2026-01-01T00:00:00Z',
  album: { title: 'OK Computer', coverVersion: 'cover-v1' },
  gain: { track: null, album: null, trackPeak: null, albumPeak: null },
  ...overrides,
})

export const albumDetails = (tracks: Track[]): AlbumDetails => ({
  album: {
    id: 7,
    libraryId: 3,
    title: 'OK Computer',
    sortTitle: 'OK Computer',
    year: 1997,
    type: 'album',
    artists: [RADIOHEAD],
    isCompilation: false,
    trackCount: tracks.length,
    duration: 0,
    coverVersion: 'cover-v1',
    match: 'matched',
    addedAt: '2026-01-01T00:00:00Z',
  },
  label: null,
  genres: [],
  mbid: null,
  discCount: 2,
  tracks,
  isFavourite: false,
})

export const playlistDetails = (tracks: Track[]): PlaylistDetails => ({
  playlist: {
    id: 5,
    name: 'Late night',
    trackCount: tracks.length,
    duration: 0,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    isShared: false,
    isOwn: true,
  },
  tracks,
})
