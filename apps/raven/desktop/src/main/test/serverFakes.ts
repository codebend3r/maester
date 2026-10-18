import type {
  EpisodeSummary,
  ItemDetails,
  ItemSummary,
  Library,
  MediaItem,
  SeasonSummary,
} from '@raven/core'
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
  ...overrides,
})

export const library = (overrides: { id: number; watchedPercent: number }): Library => ({
  id: overrides.id,
  name: 'Library',
  paths: [],
  layouts: [],
  itemCount: 0,
  unmatchedCount: 0,
  createdAt: '2026-10-16T00:00:00.000Z',
  scan: {
    state: 'idle',
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
})

export const show = { id: 4, title: 'Severance' }

export const episode = ({
  id,
  season,
  number,
  title,
  primary,
}: {
  id: number
  season: number
  number: number
  title: string
  primary: MediaItem | null
}): EpisodeSummary => ({
  ...summary({ id, type: 'episode', title, show, season, episode: number }),
  type: 'episode',
  summary: null,
  released: null,
  runtime: null,
  stillVersion: null,
  watched: false,
  primary,
})

export const season = ({ id, number }: { id: number; number: number }): SeasonSummary => ({
  ...summary({ id, type: 'season', title: `Season ${number}`, show, season: number }),
  type: 'season',
  episodeCount: 2,
  watchedCount: 0,
})
