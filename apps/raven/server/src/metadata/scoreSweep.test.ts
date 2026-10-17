import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { NestFastifyApplication } from '@nestjs/platform-fastify'
import { isMediaList } from '@raven/core'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { createApp } from '@/app'
import { DatabaseService } from '@/db/database'
import { ItemRefresher } from '@/metadata/itemRefresher'
import { MetadataService } from '@/metadata/metadataService'
import type { ExternalScore, ScoreProvider, ScoreSource, ScoreTitle } from '@/metadata/scoreSources'
import { Scores } from '@/metadata/scores'
import { RETRY_MS, ScoreSweep } from '@/metadata/scoreSweep'
import { BLANK_ITEM, type MetadataFetch } from '@/metadata/tmdbClient'
import { ScannerService } from '@/scanner/scannerService'
import { adminCookie, NOT_WATCHING, testConfig } from '@/test/app'
import { encodeClip } from '@/test/clips'
import { testDatabase } from '@/test/database'
import { fakeTmdb } from '@/test/fakeTmdb'
import { repositories } from '@/test/repositories'
import { apiFor } from '@/test/server'
import { ThumbnailService } from '@/thumbnails/thumbnailService'

type Answer = ExternalScore[] | 'unknown' | Error

const today = (): string => new Date().toISOString().slice(0, 10)

/**
 * A score source that counts its calls against `limit` a UTC day, as the
 * real clients do, and answers each with `answer`: given the title and the
 * call's number, from 1. `spend` uses the day up, as a source told so does.
 */
const fakeSource = ({
  provider,
  answer,
  limit = 100,
  hasKey = true,
}: {
  provider: ScoreProvider
  answer: (title: ScoreTitle, call: number) => Answer
  limit?: number
  hasKey?: boolean
}) => {
  const state = { answer, day: today(), used: 0, calls: 0, inFlight: 0, mostInFlight: 0 }
  const usedToday = (): number => {
    if (state.day !== today()) {
      state.day = today()
      state.used = 0
    }
    return state.used
  }
  const spend = (): void => {
    state.used = limit
  }
  const lookUp = vi.fn<ScoreSource['lookUp']>(async (title) => {
    if (usedToday() >= limit) throw new Error(`${provider} is not available right now.`)
    state.used += 1
    state.calls += 1
    state.inFlight += 1
    state.mostInFlight = Math.max(state.mostInFlight, state.inFlight)
    const reply = state.answer(title, state.calls)
    await Promise.resolve()
    state.inFlight -= 1
    if (reply instanceof Error) throw reply
    return reply
  })
  const source: ScoreSource = {
    provider,
    enabled: () => hasKey && usedToday() < limit,
    remaining: () => Math.max(0, limit - usedToday()),
    state: () => (hasKey ? 'ok' : 'off'),
    lookUp,
  }
  return { source, lookUp, state, spend }
}

const rottenTomatoes = (value: number): ExternalScore => ({
  source: 'rottenTomatoes',
  value,
  votes: null,
})

const OMDB_OFF = () => fakeSource({ provider: 'omdb', answer: () => [], hasKey: false })

describe('the score sweep', () => {
  const database = testDatabase('raven-score-sweep-')
  const metadata = () => repositories(database.get()).metadata
  const sweeps: ScoreSweep[] = []
  const sweepWith = ({ omdb, mdblist }: { omdb: ScoreSource; mdblist: ScoreSource }) => {
    const sweep = new ScoreSweep(metadata(), new Scores(metadata(), omdb, mdblist))
    sweeps.push(sweep)
    return sweep
  }
  const movies = (tmdbIds: string[]): number[] =>
    tmdbIds.map((tmdbId) =>
      metadata().save({
        item: {
          ...BLANK_ITEM,
          type: 'movie',
          tmdbId,
          number: null,
          title: tmdbId,
          imdbId: `tt${tmdbId}`,
        },
      }),
    )
  const rows = (itemId: number) =>
    database
      .get()
      .db.prepare<[number], { source: string; value: number; provider: string }>(
        `SELECT source, value, provider FROM ratings
          WHERE item_id = ? AND source <> 'tmdb' ORDER BY source`,
      )
      .all(itemId)
  const stamps = (itemId: number) =>
    database
      .get()
      .db.prepare<[number], { omdb: string | null; mdblist: string | null }>(
        'SELECT omdb_fetched_at AS omdb, mdblist_fetched_at AS mdblist FROM items WHERE id = ?',
      )
      .get(itemId)
  /** How long from now until a second before `iso`. */
  const untilJustBefore = (iso: string): number => Date.parse(iso) - Date.now() - 1000

  beforeAll(() => database.open())
  afterAll(database.close)
  afterEach(() => {
    sweeps.splice(0).forEach((sweep) => sweep.onModuleDestroy())
    database.get().db.prepare('DELETE FROM items').run()
    vi.useRealTimers()
  })

  it('tops up every due title to the end, two at a time, and asks OMDb for what MDBList does not know', async () => {
    const titles = movies(['1', '2', '3', '4'])
    const mdblist = fakeSource({
      provider: 'mdblist',
      answer: ({ tmdbId }) => (tmdbId === '4' ? 'unknown' : [rottenTomatoes(9.1)]),
    })
    const omdb = fakeSource({ provider: 'omdb', answer: () => [rottenTomatoes(5)] })
    const sweep = sweepWith({ omdb: omdb.source, mdblist: mdblist.source })

    sweep.kick()
    await sweep.whenIdle()

    expect(mdblist.lookUp).toHaveBeenCalledTimes(4)
    expect(mdblist.state.mostInFlight).toBe(2)
    expect(omdb.lookUp).toHaveBeenCalledOnce()
    expect(titles.map((itemId) => rows(itemId))).toEqual([
      [{ source: 'rottenTomatoes', value: 9.1, provider: 'mdblist' }],
      [{ source: 'rottenTomatoes', value: 9.1, provider: 'mdblist' }],
      [{ source: 'rottenTomatoes', value: 9.1, provider: 'mdblist' }],
      [{ source: 'rottenTomatoes', value: 5, provider: 'omdb' }],
    ])
    expect(sweep.pause()).toBeNull()
  })

  it('asks OMDb again for a title MDBList does not know when the first ask failed', async () => {
    const [title = -1] = movies(['1'])
    const mdblist = fakeSource({ provider: 'mdblist', answer: () => 'unknown' })
    const omdb = fakeSource({
      provider: 'omdb',
      answer: (_, call) =>
        call === 1 ? new Error('OMDb could not be reached.') : [rottenTomatoes(5)],
    })
    const sweep = sweepWith({ omdb: omdb.source, mdblist: mdblist.source })

    sweep.kick()
    await sweep.whenIdle()

    expect(mdblist.lookUp).toHaveBeenCalledOnce()
    expect(omdb.lookUp).toHaveBeenCalledTimes(2)
    expect(rows(title)).toEqual([{ source: 'rottenTomatoes', value: 5, provider: 'omdb' }])
    expect(sweep.pause()).toBeNull()
  })

  it("stops at the day's budget, and picks up again a minute past midnight UTC", async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
    vi.setSystemTime(new Date('2026-10-17T22:30:00.000Z'))
    const titles = movies(['1', '2', '3'])
    const mdblist = fakeSource({
      provider: 'mdblist',
      answer: () => [rottenTomatoes(9.1)],
      limit: 2,
    })
    const sweep = sweepWith({ omdb: OMDB_OFF().source, mdblist: mdblist.source })

    sweep.kick()
    await sweep.whenIdle()

    expect(mdblist.lookUp).toHaveBeenCalledTimes(2)
    expect(titles.map((itemId) => stamps(itemId)?.mdblist != null)).toEqual([true, true, false])
    expect(sweep.pause()).toEqual({ reason: 'budget', resumesAt: '2026-10-18T00:01:00.000Z' })

    await vi.advanceTimersByTimeAsync(untilJustBefore('2026-10-18T00:01:00.000Z'))
    expect(mdblist.lookUp).toHaveBeenCalledTimes(2)

    await vi.advanceTimersByTimeAsync(1000)
    await sweep.whenIdle()
    expect(mdblist.lookUp).toHaveBeenCalledTimes(3)
    expect(titles.map((itemId) => stamps(itemId)?.mdblist != null)).toEqual([true, true, true])
    expect(sweep.pause()).toBeNull()
  })

  it("hands over to OMDb once MDBList's day is spent, and waits for midnight only once both are", async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
    vi.setSystemTime(new Date('2026-10-17T09:00:00.000Z'))
    const titles = movies(['1', '2', '3'])
    const mdblist = fakeSource({
      provider: 'mdblist',
      answer: () => [rottenTomatoes(9.1)],
      limit: 1,
    })
    const omdb = fakeSource({ provider: 'omdb', answer: () => [rottenTomatoes(5)], limit: 1 })
    const sweep = sweepWith({ omdb: omdb.source, mdblist: mdblist.source })

    sweep.kick()
    await sweep.whenIdle()

    expect(titles.map((itemId) => rows(itemId).map((row) => row.provider))).toEqual([
      ['mdblist'],
      ['omdb'],
      [],
    ])
    expect(sweep.pause()).toEqual({ reason: 'budget', resumesAt: '2026-10-18T00:01:00.000Z' })
  })

  it('takes a source saying its day is spent as the budget, not a failure', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
    vi.setSystemTime(new Date('2026-10-17T09:00:00.000Z'))
    movies(['1'])
    const mdblist = fakeSource({ provider: 'mdblist', answer: () => [] })
    mdblist.state.answer = () => {
      mdblist.spend()
      return new Error("MDBList's daily limit is spent: Daily API limit exceeded!")
    }
    const sweep = sweepWith({ omdb: OMDB_OFF().source, mdblist: mdblist.source })

    sweep.kick()
    await sweep.whenIdle()

    expect(sweep.pause()).toEqual({ reason: 'budget', resumesAt: '2026-10-18T00:01:00.000Z' })
  })

  it('pauses as unavailable after a failure, and tries again 15 minutes later', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
    vi.setSystemTime(new Date('2026-10-17T09:00:00.000Z'))
    const titles = movies(['1', '2', '3'])
    const mdblist = fakeSource({
      provider: 'mdblist',
      answer: () => new Error('MDBList could not be reached.'),
    })
    const sweep = sweepWith({ omdb: OMDB_OFF().source, mdblist: mdblist.source })

    sweep.kick()
    await sweep.whenIdle()

    expect(mdblist.lookUp).toHaveBeenCalledTimes(2)
    expect(sweep.pause()).toEqual({
      reason: 'unavailable',
      resumesAt: new Date(Date.now() + RETRY_MS).toISOString(),
    })

    mdblist.state.answer = () => [rottenTomatoes(9.1)]
    await vi.advanceTimersByTimeAsync(RETRY_MS - 1000)
    expect(mdblist.lookUp).toHaveBeenCalledTimes(2)

    await vi.advanceTimersByTimeAsync(1000)
    await sweep.whenIdle()
    expect(titles.map((itemId) => stamps(itemId)?.mdblist != null)).toEqual([true, true, true])
    expect(sweep.pause()).toBeNull()
  })
})

/** A gate that holds a call until it is let go, and says once the call has reached it. */
const holdOpen = () => {
  const gate = { open: () => {}, reach: () => {} }
  const opened = new Promise<void>((resolve) => {
    gate.open = resolve
  })
  const reached = new Promise<void>((resolve) => {
    gate.reach = resolve
  })
  return { gate, opened, reached }
}

/** As a browser with the admin lock off, so the library can be added and scanned. */
describe('the score sweep beside matching', () => {
  const tmdb = fakeTmdb({
    movies: [
      { id: 949, title: 'Heat', released: '1995-12-15' },
      { id: 1538, title: 'Collateral', released: '2004-08-05' },
    ],
    mdblist: { 'movie:949': { rottenTomatoes: 87 }, 'movie:1538': { rottenTomatoes: 86 } },
  })
  const holding: { heat: ReturnType<typeof holdOpen> | null } = { heat: null }
  // MDBList's answer for Heat waits while it is held, so a sweep asking for it stays busy.
  const metadataFetch: MetadataFetch = async ({ url, init }) => {
    const held = holding.heat
    if (held && new URL(url).pathname === '/tmdb/movie/949/') {
      held.gate.reach()
      await held.opened
    }
    return tmdb.fetch({ url, init })
  }
  const state: {
    root: string
    media: string
    libraryId: number
    app: NestFastifyApplication | null
  } = { root: '', media: '', libraryId: 0, app: null }
  const app = (): NestFastifyApplication => {
    if (!state.app) throw new Error('app not started')
    return state.app
  }
  const settle = async (): Promise<void> => {
    await app().get(ScannerService).whenIdle(state.libraryId)
    await app().get(MetadataService).whenIdle()
    await app().get(ScoreSweep).whenIdle()
    await app().get(ThumbnailService).whenIdle()
  }
  const mdblistStamp = (): string | null =>
    app()
      .get(DatabaseService)
      .db.prepare<[], { stamp: string | null }>(
        "SELECT mdblist_fetched_at AS stamp FROM items WHERE tmdb_id = '949'",
      )
      .get()?.stamp ?? null

  beforeAll(async () => {
    state.root = await mkdtemp(join(tmpdir(), 'raven-score-sweep-app-'))
    state.media = join(state.root, 'media')
    await encodeClip({ path: join(state.media, 'Heat (1995).mp4'), seconds: 1 })
    state.app = await createApp({
      config: {
        ...testConfig({ dataDir: join(state.root, 'data'), mediaDir: state.root }),
        tmdbApiToken: 'test-token',
        mdblistApiKey: 'mdblist-key',
      },
      quiet: true,
      metadataFetch,
      watch: NOT_WATCHING,
    })
    await state.app.init()
    const admin = await adminCookie(state.app)
    const created = await apiFor({ app: state.app, cookie: admin }).createLibrary({
      name: 'Films',
      paths: [state.media],
      settings: { kind: 'movies' },
    })
    state.libraryId = created.id
    await settle()
  })

  afterAll(async () => {
    holding.heat?.gate.open()
    await settle()
    await state.app?.close()
    await rm(state.root, { recursive: true, force: true })
  })

  it('lets a match finish while a slow source holds the sweep', async () => {
    const stale = '2000-01-01T00:00:00.000Z'
    app().get(DatabaseService).db.prepare('UPDATE items SET mdblist_fetched_at = ?').run(stale)
    const held = holdOpen()
    holding.heat = held
    app()
      .get(MetadataService)
      .schedule({ key: 'sweep', task: () => app().get(ItemRefresher).sweep() })
    await held.reached
    const swept = app()
      .get(ScoreSweep)
      .whenIdle()
      .then(() => 'idle')

    await encodeClip({ path: join(state.media, 'Collateral (2004).mp4'), seconds: 1 })
    app().get(ScannerService).quickScan(state.libraryId)
    await app().get(ScannerService).whenIdle(state.libraryId)
    await app().get(MetadataService).whenIdle()

    const listed = await app().inject({
      method: 'GET',
      url: `/api/libraries/${state.libraryId}/media`,
    })
    const media: unknown = listed.json()
    expect(isMediaList(media) && media.map((item) => item.item?.title ?? null).toSorted()).toEqual([
      'Collateral',
      'Heat',
    ])
    expect(await Promise.race([swept, 'busy'])).toBe('busy')
    expect(mdblistStamp()).toBe(stale)

    held.gate.open()
    await swept
    expect(mdblistStamp()).not.toBe(stale)
  })
})
