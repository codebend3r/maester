import { copyFile, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { NestFastifyApplication } from '@nestjs/platform-fastify'
import type { ApiClient } from '@raven/core'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { createApp } from '@/app'
import type { ServerConfig } from '@/config'
import { DatabaseService } from '@/db/database'
import { MetadataService } from '@/metadata/metadataService'
import { ScoreSweep } from '@/metadata/scoreSweep'
import type { MetadataFetch } from '@/metadata/tmdbClient'
import { ScannerService } from '@/scanner/scannerService'
import { adminCookie, holdOpen, NOT_WATCHING, testConfig } from '@/test/app'
import { encodeClip } from '@/test/clips'
import { type FakeMovie, fakeTmdb } from '@/test/fakeTmdb'
import { apiFor } from '@/test/server'
import { ThumbnailService } from '@/thumbnails/thumbnailService'

const HEAT: FakeMovie = { id: 949, title: 'Heat', released: '1995-12-15', imdbId: 'tt0113277' }

const MOVIES: FakeMovie[] = [
  HEAT,
  { id: 1538, title: 'Collateral', released: '2004-08-05', imdbId: 'tt0369339' },
  { id: 8195, title: 'Ronin', released: '1998-09-25', imdbId: 'tt0122690' },
]

const MDBLIST = {
  'movie:949': { rottenTomatoes: 87 },
  'movie:1538': { rottenTomatoes: 86 },
  'movie:8195': { rottenTomatoes: 68 },
}

/**
 * A server with MDBList's key over a movies library of `files`, matched by a
 * fake TMDB and MDBList, as a browser with the admin lock off sees it, so
 * the library can be added, refreshed and deleted.
 */
const refreshServer = ({
  prefix,
  files,
  fetch,
  config = {},
}: {
  prefix: string
  files: string[]
  fetch: MetadataFetch
  config?: Partial<ServerConfig>
}) => {
  const state: {
    root: string
    media: string
    data: string
    admin: string
    libraryId: number
    app: NestFastifyApplication | null
  } = { root: '', media: '', data: '', admin: '', libraryId: 0, app: null }
  const app = (): NestFastifyApplication => {
    if (!state.app) throw new Error('app not started')
    return state.app
  }
  const api = (): ApiClient => apiFor({ app: app(), cookie: state.admin })
  const start = async (): Promise<void> => {
    state.app = await createApp({
      config: {
        ...testConfig({ dataDir: state.data, mediaDir: state.root }),
        tmdbApiToken: 'test-token',
        mdblistApiKey: 'mdblist-key',
        ...config,
      },
      quiet: true,
      metadataFetch: fetch,
      watch: NOT_WATCHING,
    })
    await state.app.init()
    state.admin = await adminCookie(state.app)
  }
  const settle = async (): Promise<void> => {
    await app().get(ScannerService).whenIdle(state.libraryId)
    await app().get(MetadataService).whenIdle()
    await app().get(ScoreSweep).whenIdle()
    await app().get(ThumbnailService).whenIdle()
  }
  return {
    state,
    app,
    api,
    settle,
    at: (...parts: string[]): string => join(state.media, ...parts),
    open: async (): Promise<void> => {
      state.root = await mkdtemp(join(tmpdir(), prefix))
      state.media = join(state.root, 'media')
      state.data = join(state.root, 'data')
      await Promise.all(
        files.map((name) => encodeClip({ path: join(state.media, name), seconds: 1 })),
      )
      await start()
      const created = await api().createLibrary({
        name: 'Films',
        paths: [state.media],
        settings: { kind: 'movies' },
      })
      state.libraryId = created.id
      await settle()
    },
    restart: async (): Promise<void> => {
      await settle()
      await state.app?.close()
      await start()
    },
    close: async (): Promise<void> => {
      await settle()
      await state.app?.close()
      await rm(state.root, { recursive: true, force: true })
    },
    /** Each score a movie has, by source. */
    scoresOf: (tmdbId: string): Record<string, number> =>
      Object.fromEntries(
        app()
          .get(DatabaseService)
          .db.prepare<[string], { source: string; value: number }>(
            `SELECT r.source, r.value FROM ratings r JOIN items i ON i.id = r.item_id
              WHERE i.type = 'movie' AND i.tmdb_id = ? ORDER BY r.source`,
          )
          .all(tmdbId)
          .map((row) => [row.source, row.value]),
      ),
    requests: (): number =>
      app()
        .get(DatabaseService)
        .db.prepare<[], { requests: number }>('SELECT COUNT(*) AS requests FROM score_requests')
        .get()?.requests ?? 0,
  }
}

describe('a library Refresh', () => {
  const tmdb = fakeTmdb({ movies: MOVIES, mdblist: MDBLIST })
  const holding: { mdblist: ReturnType<typeof holdOpen> | null } = { mdblist: null }
  // MDBList's answers wait while they are held, so a Refresh stays under way.
  const fetch: MetadataFetch = async ({ url, init }) => {
    const held = holding.mdblist
    if (held && new URL(url).host === 'api.mdblist.com') {
      held.gate.reach()
      await held.opened
    }
    return tmdb.fetch({ url, init })
  }
  const server = refreshServer({
    prefix: 'raven-refresh-',
    files: ['Heat (1995).mp4', 'Collateral (2004).mp4'],
    fetch,
  })
  /** Holds MDBList's answers until the returned function lets them go. */
  const holdMdblist = () => {
    const held = holdOpen()
    holding.mdblist = held
    return {
      reached: held.reached,
      letGo: () => {
        holding.mdblist = null
        held.gate.open()
      },
    }
  }
  const library = () => server.api().getLibrary(server.state.libraryId)
  const refresh = () => server.api().refreshLibrary(server.state.libraryId)

  beforeAll(server.open)

  afterAll(async () => {
    holding.mdblist?.gate.open()
    await server.close()
  })

  it("takes in a new file and fetches every title's ratings again, a month old or not", async () => {
    expect((await library()).ratingsRefresh).toEqual({ state: 'idle', finishedAt: null })
    expect(server.scoresOf('949')).toEqual({ rottenTomatoes: 8.7, tmdb: 8.2 })
    tmdb.state.mdblist = { ...tmdb.state.mdblist, 'movie:949': { rottenTomatoes: 90 } }
    tmdb.state.movies = tmdb.state.movies.with(0, { ...HEAT, voteAverage: 7.5 })
    await copyFile(server.at('Heat (1995).mp4'), server.at('Ronin (1998).mp4'))

    const refreshed = await refresh()
    expect(refreshed.ratingsRefresh).toEqual({
      state: 'running',
      done: 0,
      total: 2,
      startedAt: expect.any(String),
    })

    await server.settle()
    expect((await library()).ratingsRefresh).toEqual({
      state: 'idle',
      finishedAt: expect.any(String),
    })
    const media = await server.api().listMedia({ libraryId: server.state.libraryId })
    expect(media.map((item) => item.item?.title ?? null).toSorted()).toEqual([
      'Collateral',
      'Heat',
      'Ronin',
    ])
    expect(server.scoresOf('949')).toEqual({ rottenTomatoes: 9, tmdb: 7.5 })
  })

  it('keeps its count when pressed again while it runs', async () => {
    const mdblist = holdMdblist()
    const first = await refresh()
    await mdblist.reached

    const second = await refresh()

    expect(first.ratingsRefresh).toMatchObject({ state: 'running', done: 0, total: 3 })
    expect(second.ratingsRefresh).toEqual(first.ratingsRefresh)
    mdblist.letGo()
    await server.settle()
    expect((await library()).ratingsRefresh.state).toBe('idle')
  })

  it('drops what it asked for with the library', async () => {
    const mdblist = holdMdblist()
    await refresh()
    await mdblist.reached
    expect(server.requests()).toBe(3)

    await server.api().deleteLibrary(server.state.libraryId)

    expect(server.requests()).toBe(0)
    mdblist.letGo()
  })
})

describe("a Refresh past MDBList's daily limit", () => {
  const tmdb = fakeTmdb({
    movies: MOVIES,
    mdblist: MDBLIST,
    omdb: {
      tt0113277: { imdb: '8.3/10' },
      tt0369339: { imdb: '7.5/10' },
      tt0122690: { imdb: '7.2/10' },
    },
  })
  const server = refreshServer({
    prefix: 'raven-refresh-limit-',
    files: ['Heat (1995).mp4', 'Collateral (2004).mp4', 'Ronin (1998).mp4'],
    fetch: tmdb.fetch,
    config: { mdblistDailyLimit: 2, omdbApiKey: 'omdb-key' },
  })
  const library = () => server.api().getLibrary(server.state.libraryId)
  // The day after the library was matched, so MDBList has its two calls again.
  const today = new Date()
  const NEXT_NOON = new Date(
    Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() + 1, 12),
  )
  const MIDNIGHT = new Date(
    Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() + 2, 0, 1),
  )
  beforeAll(server.open)

  afterAll(async () => {
    vi.useRealTimers()
    await server.close()
  })

  it('does two titles a day, and leaves the third, which OMDb answered, to MDBList after midnight UTC', async () => {
    vi.setSystemTime(NEXT_NOON)
    const calls = { mdblist: tmdb.state.mdblistCalls, omdb: tmdb.state.omdbCalls }

    const refreshed = await server.api().refreshLibrary(server.state.libraryId)
    expect(refreshed.ratingsRefresh).toEqual({
      state: 'running',
      done: 0,
      total: 3,
      startedAt: NEXT_NOON.toISOString(),
    })

    await server.settle()
    expect(tmdb.state.mdblistCalls - calls.mdblist).toBe(2)
    expect(tmdb.state.omdbCalls - calls.omdb).toBe(1)
    expect((await library()).ratingsRefresh).toEqual({
      state: 'waiting',
      done: 2,
      total: 3,
      startedAt: NEXT_NOON.toISOString(),
      reason: 'budget',
      resumesAt: MIDNIGHT.toISOString(),
    })
  })

  it('keeps its count and what is done through a restart', async () => {
    const before = (await library()).ratingsRefresh
    // A new client counts no calls yet today; MDBList's own answer says the day is spent.
    tmdb.state.mdblistSpent = true

    await server.restart()
    await server.settle()

    expect((await library()).ratingsRefresh).toEqual(before)
  })

  it('finishes once MDBList answers for the last title after midnight UTC', async () => {
    tmdb.state.mdblistSpent = false
    const afterMidnight = new Date(MIDNIGHT.getTime() + 60_000)
    vi.setSystemTime(afterMidnight)

    server.app().get(ScoreSweep).kick()
    await server.settle()

    expect((await library()).ratingsRefresh).toEqual({
      state: 'idle',
      finishedAt: afterMidnight.toISOString(),
    })
  })
})
