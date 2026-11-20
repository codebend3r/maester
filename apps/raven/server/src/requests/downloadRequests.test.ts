import { ITEM_TYPES, REQUEST_STATUSES } from '@raven/core'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { readServerConfig } from '@/config'
import type { MetadataFetch } from '@/metadata/tmdbClient'
import { ArrClient } from '@/requests/arrClient'
import {
  BUDGET_WINDOW_MS,
  DownloadRequests,
  HOLDINGS_FRESH_MS,
  STATUS_FRESH_MS,
} from '@/requests/downloadRequests'
import { REQUESTS_ENV } from '@/requests/requestsConfig'
import { manualClock } from '@/test/clock'
import { testDatabase } from '@/test/database'
import { TEST_ACCOUNTS } from '@/test/repositories'

const SONARR = 'http://sonarr.test'
const RADARR = 'http://radarr.test'

type Sent = { method: string; url: string; body: unknown }

type FakeArrState = {
  /** What each lookup finds, by TMDB id, and the arr's id for a title it holds. */
  movies: Record<string, { title: string; id?: number }>
  shows: Record<string, { title: string; id?: number }>
  rootFolders: string[]
  /** The resolutions the HD-1080p profile allows. */
  resolutions: number[]
  queue: unknown[]
  hasFile: boolean
  /** The first day out each title's record says, as the arr writes it; none when unset. */
  released?: string
  /** What Radarr's calendar lists, and every series Sonarr holds. */
  calendar: unknown[]
  series: unknown[]
  commandStatus: string
  /** Paths answered 500, to stand for an arr that fails. */
  failing: string[]
  sent: Sent[]
}

const freshState = (): FakeArrState => ({
  movies: {
    '1': { title: 'A Beautiful Mind' },
    '2': { title: 'Sinners', id: 77 },
    '4': { title: 'Barbarian' },
  },
  shows: { '10': { title: 'The Bear' }, '11': { title: 'Severance', id: 88 } },
  rootFolders: ['/Meleys/Movies/B', '/Meleys/Movies/S', '/Vermithor/TV/B'],
  resolutions: [1080, 1080],
  queue: [],
  hasFile: false,
  calendar: [],
  series: [],
  commandStatus: 'started',
  failing: [],
  sent: [],
})

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

/** Sonarr and Radarr as far as requests talk to them. */
const fakeArrs =
  (state: FakeArrState): MetadataFetch =>
  async ({ url, init }) => {
    const parsed = new URL(url)
    const method = init.method ?? 'GET'
    const body: unknown = init.body === undefined ? undefined : JSON.parse(init.body)
    state.sent.push({ method, url, body })
    const path = parsed.pathname
    if (state.failing.includes(path)) return json({ message: 'down' }, 500)
    if (path === '/api/v3/rootfolder')
      return json(state.rootFolders.map((folder) => ({ path: folder })))
    if (path === '/api/v3/qualityprofile') {
      return json([
        {
          id: 4,
          name: 'HD-1080p',
          items: [
            { allowed: false, quality: { resolution: 720 } },
            {
              allowed: true,
              items: state.resolutions.map((resolution) => ({ quality: { resolution } })),
            },
          ],
        },
        { id: 5, name: 'Ultra-HD', items: [{ allowed: true, quality: { resolution: 2160 } }] },
      ])
    }
    // Radarr's TMDB lookup answers fresh metadata, with no id even for a movie it holds.
    if (path === '/api/v3/movie/lookup/tmdb') {
      const found = state.movies[parsed.searchParams.get('tmdbId') ?? '']
      return found
        ? json({ title: found.title, id: null, tmdbId: 1 })
        : json({ message: 'not found' }, 404)
    }
    if (method === 'GET' && path === '/api/v3/movie') {
      const held = state.movies[parsed.searchParams.get('tmdbId') ?? '']?.id
      return json(held === undefined ? [] : [{ id: held, title: 'held' }])
    }
    if (path === '/api/v3/series/lookup') {
      const found = state.shows[(parsed.searchParams.get('term') ?? '').replace('tmdb:', '')]
      return json(found ? [found] : [])
    }
    if (method === 'POST' && (path === '/api/v3/movie' || path === '/api/v3/series')) {
      return json({ id: 500 })
    }
    if (method === 'POST' && path === '/api/v3/command') return json({ id: 900 })
    if (path.startsWith('/api/v3/command/')) return json({ status: state.commandStatus })
    if (path === '/api/v3/queue/details') return json(state.queue)
    if (path === '/api/v3/calendar') return json(state.calendar)
    if (method === 'GET' && path === '/api/v3/series') return json(state.series)
    if (path.startsWith('/api/v3/movie/')) {
      return json({ hasFile: state.hasFile, inCinemas: state.released })
    }
    if (path.startsWith('/api/v3/series/')) {
      return json({
        firstAired: state.released,
        statistics: { episodeFileCount: state.hasFile ? 3 : 0 },
      })
    }
    return json({ message: `unexpected ${method} ${path}` }, 404)
  }

describe('download requests', () => {
  const database = testDatabase('raven-download-requests-')
  const state: { arr: FakeArrState } = { arr: freshState() }
  const time = manualClock()
  const config = {
    ...readServerConfig({
      [REQUESTS_ENV.sonarrUrl]: SONARR,
      [REQUESTS_ENV.sonarrKey]: 'sonarr-key',
      [REQUESTS_ENV.radarrUrl]: `${RADARR}/`,
      [REQUESTS_ENV.radarrKey]: 'radarr-key',
      [REQUESTS_ENV.dailyLimit]: '2',
    }),
  }
  const requests = () =>
    new DownloadRequests(
      database.get(),
      new ArrClient(config, fakeArrs(state.arr)),
      config,
      time.clock,
    )

  beforeAll(() => database.open())
  afterAll(() => database.close())
  beforeEach(() => {
    state.arr = freshState()
    database.get().db.exec('DELETE FROM download_requests')
    database.get().db.exec('DELETE FROM items')
    time.advance(BUDGET_WINDOW_MS * 2)
  })

  it('adds a movie under its letter folder, monitored, then searches for it', async () => {
    const made = await requests().request({
      account: TEST_ACCOUNTS.a,
      isUnlimited: false,
      ask: { type: ITEM_TYPES.movie, tmdbId: '1' },
    })
    expect(made).toMatchObject({
      type: ITEM_TYPES.movie,
      tmdbId: '1',
      title: 'A Beautiful Mind',
      status: REQUEST_STATUSES.searching,
      isMine: true,
      libraryItemId: null,
    })
    const added = state.arr.sent.find(
      (sent) => sent.method === 'POST' && sent.url.endsWith('/movie'),
    )
    expect(added?.url).toBe(`${RADARR}/api/v3/movie`)
    expect(added?.body).toMatchObject({
      rootFolderPath: '/Meleys/Movies/B',
      qualityProfileId: 4,
      monitored: true,
      minimumAvailability: 'released',
    })
    const search = state.arr.sent.find((sent) => sent.url.endsWith('/command'))
    expect(search?.body).toEqual({ name: 'MoviesSearch', movieIds: [500] })
  })

  it('names the library item once a scan has added the requested title', async () => {
    await requests().request({
      account: TEST_ACCOUNTS.a,
      isUnlimited: false,
      ask: { type: ITEM_TYPES.movie, tmdbId: '1' },
    })
    database.get().db.exec(
      `INSERT INTO items (id, type, tmdb_id, title, sort_title, fetched_at)
         VALUES (42, 'movie', '1', 'A Beautiful Mind', 'Beautiful Mind', '2026-01-01')`,
    )
    const { requests: listed } = await requests().list({
      account: TEST_ACCOUNTS.a,
      isUnlimited: false,
    })
    expect(listed.map((request) => request.libraryItemId)).toEqual([42])
  })

  it('files a show under its letter without the article, and searches the series', async () => {
    await requests().request({
      account: TEST_ACCOUNTS.a,
      isUnlimited: false,
      ask: { type: ITEM_TYPES.show, tmdbId: '10' },
    })
    const added = state.arr.sent.find(
      (sent) => sent.method === 'POST' && sent.url.endsWith('/series'),
    )
    expect(added?.url).toBe(`${SONARR}/api/v3/series`)
    expect(added?.body).toMatchObject({ rootFolderPath: '/Vermithor/TV/B', seasonFolder: true })
    const search = state.arr.sent.find((sent) => sent.url.endsWith('/command'))
    expect(search?.body).toEqual({ name: 'SeriesSearch', seriesId: 500 })
  })

  it('refuses a title the arr already holds, sends it nothing, and spends nothing', async () => {
    const ask = { type: ITEM_TYPES.movie, tmdbId: '2' } as const
    await expect(
      requests().request({ account: TEST_ACCOUNTS.a, isUnlimited: false, ask }),
    ).rejects.toThrow('holds this title already')
    expect(state.arr.sent.some((sent) => sent.method === 'POST')).toBe(false)
    const after = await requests().list({ account: TEST_ACCOUNTS.a, isUnlimited: false })
    expect(after.requests).toHaveLength(0)
    expect(after.budget.left).toBe(2)
  })

  it('says where a title the arr holds stands, and null for one it does not', async () => {
    state.arr.queue = [{ status: 'queued' }]
    const service = requests()
    expect(await service.holding({ type: ITEM_TYPES.movie, tmdbId: '2' })).toEqual({
      status: REQUEST_STATUSES.willDownload,
    })
    expect(await service.holding({ type: ITEM_TYPES.movie, tmdbId: '1' })).toEqual({
      status: null,
    })
    expect(await service.holding({ type: ITEM_TYPES.show, tmdbId: '10' })).toEqual({
      status: null,
    })
    expect(await service.holding({ type: ITEM_TYPES.show, tmdbId: '11' })).toEqual({
      status: REQUEST_STATUSES.willDownload,
    })
  })

  it('counts no file the arr holds of a title that has not come out yet', async () => {
    state.arr.hasFile = true
    state.arr.released = '2099-11-25T00:00:00Z'
    const service = requests()
    expect(await service.holding({ type: ITEM_TYPES.show, tmdbId: '11' })).toEqual({
      status: REQUEST_STATUSES.notDownloadable,
    })
    expect(await service.holding({ type: ITEM_TYPES.movie, tmdbId: '2' })).toEqual({
      status: REQUEST_STATUSES.notDownloadable,
    })
    state.arr.released = new Date(time.clock.now()).toISOString()
    time.advance(STATUS_FRESH_MS)
    expect(await service.holding({ type: ITEM_TYPES.show, tmdbId: '11' })).toEqual({
      status: REQUEST_STATUSES.downloaded,
    })
  })

  it('refuses a show the arr already holds, and sends it nothing', async () => {
    const ask = { type: ITEM_TYPES.show, tmdbId: '11' } as const
    await expect(
      requests().request({ account: TEST_ACCOUNTS.a, isUnlimited: false, ask }),
    ).rejects.toThrow('holds this title already')
    expect(state.arr.sent.some((sent) => sent.method === 'POST')).toBe(false)
  })

  it('reads a holding from the arr at most once in a while, and again after a failure', async () => {
    const service = requests()
    const ask = { type: ITEM_TYPES.movie, tmdbId: '2' } as const
    const lookups = () =>
      state.arr.sent.filter((sent) => sent.url.startsWith(`${RADARR}/api/v3/movie?`)).length
    state.arr.failing = ['/api/v3/movie']
    await expect(service.holding(ask)).rejects.toThrow('500')
    state.arr.failing = []
    expect((await service.holding(ask)).status).toBe(REQUEST_STATUSES.notDownloadable)
    await service.holding(ask)
    expect(lookups()).toBe(2)
    time.advance(STATUS_FRESH_MS)
    await service.holding(ask)
    expect(lookups()).toBe(3)
  })

  it('lists the titles still to come an arr holds as requests nobody made', async () => {
    const today = new Date(time.clock.now()).toISOString().slice(0, 10)
    state.arr.calendar = [
      {
        id: 61,
        title: 'Dune: Part Three',
        tmdbId: 300,
        added: '2026-01-02T03:04:05Z',
        inCinemas: `${today}T00:00:00Z`,
      },
      {
        id: 62,
        title: 'Out Already',
        tmdbId: 301,
        added: '2026-01-03T00:00:00Z',
        inCinemas: '1960-01-01T00:00:00Z',
        digitalRelease: `${today}T00:00:00Z`,
      },
    ]
    state.arr.series = [
      {
        id: 71,
        title: 'Blade Runner 2099',
        tmdbId: 400,
        added: '2026-01-04T00:00:00Z',
        firstAired: `${today}T00:00:00Z`,
        statistics: { episodeFileCount: 8 },
      },
      {
        id: 72,
        title: 'Long Running',
        tmdbId: 401,
        added: '2020-01-01T00:00:00Z',
        firstAired: '1960-02-02T00:00:00Z',
      },
      {
        id: 74,
        title: 'Not Out Yet',
        tmdbId: 402,
        added: '2025-10-25T04:27:41Z',
        firstAired: '2099-11-25T00:00:00Z',
        statistics: { episodeFileCount: 8 },
      },
      {
        id: 73,
        title: 'No TMDB id',
        added: '2026-01-05T00:00:00Z',
        firstAired: `${today}T00:00:00Z`,
      },
    ]
    state.arr.queue = [{ movieId: 61, seriesId: null, status: 'downloading' }]
    database
      .get()
      .db.prepare(
        `INSERT INTO items (id, type, tmdb_id, title, sort_title, fetched_at)
         VALUES (9, 'show', '400', 'Blade Runner 2099', 'blade runner 2099', '2026-01-01')`,
      )
      .run()
    const service = requests()
    const list = await service.list({ account: TEST_ACCOUNTS.a, isUnlimited: false })
    expect(list.requests).toEqual([
      {
        type: ITEM_TYPES.show,
        tmdbId: '400',
        title: 'Blade Runner 2099',
        status: REQUEST_STATUSES.downloaded,
        requestedAt: '2026-01-04T00:00:00Z',
        isMine: false,
        isHeld: true,
        libraryItemId: 9,
      },
      {
        type: ITEM_TYPES.movie,
        tmdbId: '300',
        title: 'Dune: Part Three',
        status: REQUEST_STATUSES.downloading,
        requestedAt: '2026-01-02T03:04:05Z',
        isMine: false,
        isHeld: true,
        libraryItemId: null,
      },
      {
        type: ITEM_TYPES.show,
        tmdbId: '402',
        title: 'Not Out Yet',
        status: REQUEST_STATUSES.notDownloadable,
        requestedAt: '2025-10-25T04:27:41Z',
        isMine: false,
        isHeld: true,
        libraryItemId: null,
      },
    ])
    const asked = state.arr.sent.length
    await service.list({ account: TEST_ACCOUNTS.b, isUnlimited: false })
    expect(state.arr.sent).toHaveLength(asked)
    time.advance(HOLDINGS_FRESH_MS)
    await service.list({ account: TEST_ACCOUNTS.b, isUnlimited: false })
    expect(state.arr.sent.length).toBeGreaterThan(asked)
  })

  it('lists a held title someone asked raven for once, as their request', async () => {
    const today = new Date(time.clock.now()).toISOString().slice(0, 10)
    const service = requests()
    await service.request({
      account: TEST_ACCOUNTS.a,
      isUnlimited: false,
      ask: { type: ITEM_TYPES.movie, tmdbId: '1' },
    })
    state.arr.calendar = [
      {
        id: 500,
        title: 'A Beautiful Mind',
        tmdbId: 1,
        added: '2026-01-02T00:00:00Z',
        inCinemas: `${today}T00:00:00Z`,
      },
    ]
    const list = await service.list({ account: TEST_ACCOUNTS.a, isUnlimited: false })
    expect(list.requests).toMatchObject([{ tmdbId: '1', isMine: true, isHeld: false }])
  })

  it('lists the requests alone while an arr cannot say what it holds', async () => {
    state.arr.failing = ['/api/v3/calendar', '/api/v3/series']
    const list = await requests().list({ account: TEST_ACCOUNTS.a, isUnlimited: false })
    expect(list.requests).toEqual([])
  })

  it('tells the owner whose each request was, and which titles an arr holds with nobody asking', async () => {
    const today = new Date(time.clock.now()).toISOString().slice(0, 10)
    state.arr.series = [
      {
        id: 71,
        title: 'Held',
        tmdbId: 400,
        added: '1960-01-04T00:00:00Z',
        firstAired: `${today}T00:00:00Z`,
      },
    ]
    const service = requests()
    await service.request({
      account: TEST_ACCOUNTS.b,
      isUnlimited: false,
      ask: { type: ITEM_TYPES.movie, tmdbId: '1' },
    })
    expect(await service.everyone({ account: TEST_ACCOUNTS.a })).toMatchObject([
      { tmdbId: '1', title: 'A Beautiful Mind', isMine: false, requestedBy: TEST_ACCOUNTS.b },
      { tmdbId: '400', title: 'Held', isHeld: true, requestedBy: null },
    ])
  })

  it('never runs whoever manages raven out of requests, and counts none of theirs', async () => {
    const service = requests()
    const owner = { account: TEST_ACCOUNTS.a, isUnlimited: true }
    await service.request({ ...owner, ask: { type: ITEM_TYPES.movie, tmdbId: '1' } })
    await service.request({ ...owner, ask: { type: ITEM_TYPES.movie, tmdbId: '4' } })
    await service.request({ ...owner, ask: { type: ITEM_TYPES.show, tmdbId: '10' } })
    expect((await service.list(owner)).budget).toEqual({
      limit: 2,
      left: 2,
      nextAt: null,
      isUnlimited: true,
    })
  })

  it('takes one request a title, for everyone', async () => {
    const ask = { type: ITEM_TYPES.movie, tmdbId: '1' } as const
    await requests().request({ account: TEST_ACCOUNTS.a, isUnlimited: false, ask })
    await expect(
      requests().request({ account: TEST_ACCOUNTS.b, isUnlimited: false, ask }),
    ).rejects.toThrow('requested this already')
    const seen = await requests().list({ account: TEST_ACCOUNTS.b, isUnlimited: false })
    expect(seen.requests).toHaveLength(1)
    expect(seen.requests[0]?.isMine).toBe(false)
    expect(seen.budget.left).toBe(2)
  })

  it('answers two members asking at once with one request', async () => {
    const ask = { type: ITEM_TYPES.movie, tmdbId: '1' } as const
    const results = await Promise.allSettled([
      requests().request({ account: TEST_ACCOUNTS.a, isUnlimited: false, ask }),
      requests().request({ account: TEST_ACCOUNTS.b, isUnlimited: false, ask }),
    ])
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
  })

  it('refuses a request past the budget, and gives one back 24 hours on', async () => {
    const service = requests()
    await service.request({
      account: TEST_ACCOUNTS.a,
      isUnlimited: false,
      ask: { type: ITEM_TYPES.movie, tmdbId: '1' },
    })
    time.advance(1000)
    await service.request({
      account: TEST_ACCOUNTS.a,
      isUnlimited: false,
      ask: { type: ITEM_TYPES.movie, tmdbId: '4' },
    })
    const spent = await service.list({ account: TEST_ACCOUNTS.a, isUnlimited: false })
    expect(spent.budget).toMatchObject({ limit: 2, left: 0 })
    expect(spent.budget.nextAt).not.toBeNull()
    await expect(
      service.request({
        account: TEST_ACCOUNTS.a,
        isUnlimited: false,
        ask: { type: ITEM_TYPES.show, tmdbId: '10' },
      }),
    ).rejects.toThrow('spent')
    expect((await service.list({ account: TEST_ACCOUNTS.b, isUnlimited: false })).budget.left).toBe(
      2,
    )
    time.advance(BUDGET_WINDOW_MS - 500)
    expect((await service.list({ account: TEST_ACCOUNTS.a, isUnlimited: false })).budget.left).toBe(
      1,
    )
  })

  it('spends nothing when the arr fails, and leaves the title free to request', async () => {
    state.arr.failing = ['/api/v3/command']
    const ask = { type: ITEM_TYPES.movie, tmdbId: '1' } as const
    await expect(
      requests().request({ account: TEST_ACCOUNTS.a, isUnlimited: false, ask }),
    ).rejects.toThrow('500')
    const after = await requests().list({ account: TEST_ACCOUNTS.a, isUnlimited: false })
    expect(after.requests).toHaveLength(0)
    expect(after.budget.left).toBe(2)
  })

  it('refuses a profile that would download anything but 1080p, and spends nothing', async () => {
    state.arr.resolutions = [1080, 2160]
    const ask = { type: ITEM_TYPES.movie, tmdbId: '1' } as const
    await expect(
      requests().request({ account: TEST_ACCOUNTS.a, isUnlimited: false, ask }),
    ).rejects.toThrow('allows more than 1080p')
    expect(state.arr.sent.some((sent) => sent.method === 'POST')).toBe(false)
    expect(
      (await requests().list({ account: TEST_ACCOUNTS.a, isUnlimited: false })).budget.left,
    ).toBe(2)
  })

  it('refuses a title whose letter folder the arr does not list', async () => {
    state.arr.rootFolders = ['/Meleys/Movies/S']
    await expect(
      requests().request({
        account: TEST_ACCOUNTS.a,
        isUnlimited: false,
        ask: { type: ITEM_TYPES.movie, tmdbId: '1' },
      }),
    ).rejects.toThrow('/Meleys/Movies/B')
  })

  it('reads each status from the arr, at most once in a while', async () => {
    const service = requests()
    await service.request({
      account: TEST_ACCOUNTS.a,
      isUnlimited: false,
      ask: { type: ITEM_TYPES.movie, tmdbId: '1' },
    })
    const statusAfter = async (change: () => void): Promise<string | undefined> => {
      change()
      time.advance(STATUS_FRESH_MS)
      return (await service.list({ account: TEST_ACCOUNTS.a, isUnlimited: false })).requests[0]
        ?.status
    }
    expect(await statusAfter(() => undefined)).toBe(REQUEST_STATUSES.searching)
    expect(
      await statusAfter(() => {
        state.arr.commandStatus = 'completed'
      }),
    ).toBe(REQUEST_STATUSES.notDownloadable)
    expect(
      await statusAfter(() => {
        state.arr.queue = [{ status: 'queued', trackedDownloadState: 'downloading' }]
      }),
    ).toBe(REQUEST_STATUSES.willDownload)
    expect(
      await statusAfter(() => {
        state.arr.queue = [{ status: 'downloading', trackedDownloadState: 'downloading' }]
      }),
    ).toBe(REQUEST_STATUSES.downloading)
    expect(
      await statusAfter(() => {
        state.arr.queue = [{ status: 'completed', trackedDownloadState: 'importPending' }]
      }),
    ).toBe(REQUEST_STATUSES.downloaded)
    expect(
      await statusAfter(() => {
        state.arr.queue = []
        state.arr.hasFile = true
      }),
    ).toBe(REQUEST_STATUSES.downloaded)
    const asked = state.arr.sent.length
    await service.list({ account: TEST_ACCOUNTS.a, isUnlimited: false })
    expect(state.arr.sent.length).toBe(asked)
  })

  it('keeps the last status while the arr cannot be reached', async () => {
    const service = requests()
    await service.request({
      account: TEST_ACCOUNTS.a,
      isUnlimited: false,
      ask: { type: ITEM_TYPES.movie, tmdbId: '1' },
    })
    state.arr.failing = ['/api/v3/queue/details']
    time.advance(STATUS_FRESH_MS)
    expect(
      (await service.list({ account: TEST_ACCOUNTS.a, isUnlimited: false })).requests[0]?.status,
    ).toBe(REQUEST_STATUSES.searching)
  })

  it('says which kinds can be requested, and refuses one that is off', async () => {
    const offConfig = readServerConfig({})
    const off = new DownloadRequests(
      database.get(),
      new ArrClient(offConfig, fakeArrs(state.arr)),
      offConfig,
      time.clock,
    )
    expect((await off.list({ account: TEST_ACCOUNTS.a, isUnlimited: false })).kinds).toEqual({
      movie: false,
      show: false,
    })
    await expect(
      off.request({
        account: TEST_ACCOUNTS.a,
        isUnlimited: false,
        ask: { type: ITEM_TYPES.movie, tmdbId: '1' },
      }),
    ).rejects.toThrow('off')
    expect(state.arr.sent).toHaveLength(0)
  })

  it('never sends the key anywhere but the header', async () => {
    await requests().request({
      account: TEST_ACCOUNTS.a,
      isUnlimited: false,
      ask: { type: ITEM_TYPES.movie, tmdbId: '1' },
    })
    expect(state.arr.sent.every((sent) => !sent.url.includes('radarr-key'))).toBe(true)
  })
})
