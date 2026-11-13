import { ITEM_TYPES, REQUEST_STATUSES } from '@raven/core'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { readServerConfig } from '@/config'
import type { MetadataFetch } from '@/metadata/tmdbClient'
import { ArrClient } from '@/requests/arrClient'
import { BUDGET_WINDOW_MS, DownloadRequests, STATUS_FRESH_MS } from '@/requests/downloadRequests'
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
    if (path.startsWith('/api/v3/movie/')) return json({ hasFile: state.hasFile })
    if (path.startsWith('/api/v3/series/')) {
      return json({ statistics: { episodeFileCount: state.hasFile ? 3 : 0 } })
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
    time.advance(BUDGET_WINDOW_MS * 2)
  })

  it('adds a movie under its letter folder, monitored, then searches for it', async () => {
    const made = await requests().request({
      account: TEST_ACCOUNTS.a,
      ask: { type: ITEM_TYPES.movie, tmdbId: '1' },
    })
    expect(made).toMatchObject({
      type: ITEM_TYPES.movie,
      tmdbId: '1',
      title: 'A Beautiful Mind',
      status: REQUEST_STATUSES.searching,
      isMine: true,
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

  it('files a show under its letter without the article, and searches the series', async () => {
    await requests().request({
      account: TEST_ACCOUNTS.a,
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
    await expect(requests().request({ account: TEST_ACCOUNTS.a, ask })).rejects.toThrow(
      'holds this title already',
    )
    expect(state.arr.sent.some((sent) => sent.method === 'POST')).toBe(false)
    const after = await requests().list({ account: TEST_ACCOUNTS.a })
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

  it('refuses a show the arr already holds, and sends it nothing', async () => {
    const ask = { type: ITEM_TYPES.show, tmdbId: '11' } as const
    await expect(requests().request({ account: TEST_ACCOUNTS.a, ask })).rejects.toThrow(
      'holds this title already',
    )
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

  it('takes one request a title, for everyone', async () => {
    const ask = { type: ITEM_TYPES.movie, tmdbId: '1' } as const
    await requests().request({ account: TEST_ACCOUNTS.a, ask })
    await expect(requests().request({ account: TEST_ACCOUNTS.b, ask })).rejects.toThrow(
      'requested this already',
    )
    const seen = await requests().list({ account: TEST_ACCOUNTS.b })
    expect(seen.requests).toHaveLength(1)
    expect(seen.requests[0]?.isMine).toBe(false)
    expect(seen.budget.left).toBe(2)
  })

  it('answers two members asking at once with one request', async () => {
    const ask = { type: ITEM_TYPES.movie, tmdbId: '1' } as const
    const results = await Promise.allSettled([
      requests().request({ account: TEST_ACCOUNTS.a, ask }),
      requests().request({ account: TEST_ACCOUNTS.b, ask }),
    ])
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
  })

  it('refuses a request past the budget, and gives one back 24 hours on', async () => {
    const service = requests()
    await service.request({
      account: TEST_ACCOUNTS.a,
      ask: { type: ITEM_TYPES.movie, tmdbId: '1' },
    })
    time.advance(1000)
    await service.request({
      account: TEST_ACCOUNTS.a,
      ask: { type: ITEM_TYPES.movie, tmdbId: '4' },
    })
    const spent = await service.list({ account: TEST_ACCOUNTS.a })
    expect(spent.budget).toMatchObject({ limit: 2, left: 0 })
    expect(spent.budget.nextAt).not.toBeNull()
    await expect(
      service.request({ account: TEST_ACCOUNTS.a, ask: { type: ITEM_TYPES.show, tmdbId: '10' } }),
    ).rejects.toThrow('spent')
    expect((await service.list({ account: TEST_ACCOUNTS.b })).budget.left).toBe(2)
    time.advance(BUDGET_WINDOW_MS - 500)
    expect((await service.list({ account: TEST_ACCOUNTS.a })).budget.left).toBe(1)
  })

  it('spends nothing when the arr fails, and leaves the title free to request', async () => {
    state.arr.failing = ['/api/v3/command']
    const ask = { type: ITEM_TYPES.movie, tmdbId: '1' } as const
    await expect(requests().request({ account: TEST_ACCOUNTS.a, ask })).rejects.toThrow('500')
    const after = await requests().list({ account: TEST_ACCOUNTS.a })
    expect(after.requests).toHaveLength(0)
    expect(after.budget.left).toBe(2)
  })

  it('refuses a profile that would download anything but 1080p, and spends nothing', async () => {
    state.arr.resolutions = [1080, 2160]
    const ask = { type: ITEM_TYPES.movie, tmdbId: '1' } as const
    await expect(requests().request({ account: TEST_ACCOUNTS.a, ask })).rejects.toThrow(
      'allows more than 1080p',
    )
    expect(state.arr.sent.some((sent) => sent.method === 'POST')).toBe(false)
    expect((await requests().list({ account: TEST_ACCOUNTS.a })).budget.left).toBe(2)
  })

  it('refuses a title whose letter folder the arr does not list', async () => {
    state.arr.rootFolders = ['/Meleys/Movies/S']
    await expect(
      requests().request({
        account: TEST_ACCOUNTS.a,
        ask: { type: ITEM_TYPES.movie, tmdbId: '1' },
      }),
    ).rejects.toThrow('/Meleys/Movies/B')
  })

  it('reads each status from the arr, at most once in a while', async () => {
    const service = requests()
    await service.request({
      account: TEST_ACCOUNTS.a,
      ask: { type: ITEM_TYPES.movie, tmdbId: '1' },
    })
    const statusAfter = async (change: () => void): Promise<string | undefined> => {
      change()
      time.advance(STATUS_FRESH_MS)
      return (await service.list({ account: TEST_ACCOUNTS.a })).requests[0]?.status
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
    await service.list({ account: TEST_ACCOUNTS.a })
    expect(state.arr.sent.length).toBe(asked)
  })

  it('keeps the last status while the arr cannot be reached', async () => {
    const service = requests()
    await service.request({
      account: TEST_ACCOUNTS.a,
      ask: { type: ITEM_TYPES.movie, tmdbId: '1' },
    })
    state.arr.failing = ['/api/v3/queue/details']
    time.advance(STATUS_FRESH_MS)
    expect((await service.list({ account: TEST_ACCOUNTS.a })).requests[0]?.status).toBe(
      REQUEST_STATUSES.searching,
    )
  })

  it('says which kinds can be requested, and refuses one that is off', async () => {
    const offConfig = readServerConfig({})
    const off = new DownloadRequests(
      database.get(),
      new ArrClient(offConfig, fakeArrs(state.arr)),
      offConfig,
      time.clock,
    )
    expect((await off.list({ account: TEST_ACCOUNTS.a })).kinds).toEqual({
      movie: false,
      show: false,
    })
    await expect(
      off.request({ account: TEST_ACCOUNTS.a, ask: { type: ITEM_TYPES.movie, tmdbId: '1' } }),
    ).rejects.toThrow('off')
    expect(state.arr.sent).toHaveLength(0)
  })

  it('never sends the key anywhere but the header', async () => {
    await requests().request({
      account: TEST_ACCOUNTS.a,
      ask: { type: ITEM_TYPES.movie, tmdbId: '1' },
    })
    expect(state.arr.sent.every((sent) => !sent.url.includes('radarr-key'))).toBe(true)
  })
})
