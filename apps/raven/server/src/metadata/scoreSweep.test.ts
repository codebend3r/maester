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
import { GIVE_UP_AFTER, RETRY_MS, ScoreSweep } from '@/metadata/scoreSweep'
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
 * call's number, from 1. Each call waits for `until` first, so a test can
 * hold the calls in flight. `spend` uses the day up, as a source told so does.
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
  const state = {
    answer,
    until: Promise.resolve(),
    day: today(),
    used: 0,
    calls: 0,
    inFlight: 0,
    mostInFlight: 0,
  }
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
    await state.until
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
  /** Holds every call from now until the returned function lets them go. */
  const hold = (): (() => void) => {
    const gate = { open: () => {} }
    state.until = new Promise<void>((resolve) => {
      gate.open = resolve
    })
    return () => gate.open()
  }
  return { source, lookUp, state, spend, hold }
}

const rottenTomatoes = (value: number): ExternalScore => ({
  source: 'rottenTomatoes',
  value,
  votes: null,
})

const OMDB_OFF = () => fakeSource({ provider: 'omdb', answer: () => [], hasKey: false })

/** The TMDB ids a source was asked about, in order. */
const askedFor = (lookUp: ReturnType<typeof fakeSource>['lookUp']): string[] =>
  lookUp.mock.calls.map(([title]) => title.tmdbId)

describe('the score sweep', () => {
  const database = testDatabase('raven-score-sweep-')
  const metadata = () => repositories(database.get()).metadata
  const sweeps: ScoreSweep[] = []
  const sweepWith = ({ omdb, mdblist }: { omdb: ScoreSource; mdblist: ScoreSource }) => {
    const repository = metadata()
    const sweep = new ScoreSweep(repository, new Scores(repository, omdb, mdblist))
    sweeps.push(sweep)
    return { sweep, repository }
  }
  const title = ({
    type = 'movie',
    tmdbId,
    imdbId = `tt${tmdbId}`,
  }: {
    type?: 'movie' | 'show'
    tmdbId: string
    imdbId?: string | null
  }): number =>
    metadata().save({
      item: { ...BLANK_ITEM, type, tmdbId, number: null, title: tmdbId, imdbId },
    })
  const movies = (tmdbIds: string[]): number[] => tmdbIds.map((tmdbId) => title({ tmdbId }))
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
  const isStamped = (itemIds: number[]): boolean[] =>
    itemIds.map((itemId) => stamps(itemId)?.mdblist != null)
  /** Fake timers from 09:00 UTC, or `at`, so pauses read in whole times. */
  const fakeClock = (at = '2026-10-17T09:00:00.000Z'): void => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
    vi.setSystemTime(new Date(at))
  }
  /** How long from now until a second before `iso`. */
  const untilJustBefore = (iso: string): number => Date.parse(iso) - Date.now() - 1000
  const MIDNIGHT = '2026-10-18T00:01:00.000Z'

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
    const { sweep } = sweepWith({ omdb: omdb.source, mdblist: mdblist.source })

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
    const [unknown = -1] = movies(['1'])
    const mdblist = fakeSource({ provider: 'mdblist', answer: () => 'unknown' })
    const omdb = fakeSource({
      provider: 'omdb',
      answer: (_, call) =>
        call === 1 ? new Error('OMDb could not be reached.') : [rottenTomatoes(5)],
    })
    const { sweep } = sweepWith({ omdb: omdb.source, mdblist: mdblist.source })

    sweep.kick()
    await sweep.whenIdle()

    expect(mdblist.lookUp).toHaveBeenCalledOnce()
    expect(omdb.lookUp).toHaveBeenCalledTimes(2)
    expect(rows(unknown)).toEqual([{ source: 'rottenTomatoes', value: 5, provider: 'omdb' }])
    expect(sweep.pause()).toBeNull()
  })

  it("stops at the day's budget, and picks up again a minute past midnight UTC", async () => {
    fakeClock('2026-10-17T22:30:00.000Z')
    const titles = movies(['1', '2', '3'])
    const mdblist = fakeSource({
      provider: 'mdblist',
      answer: () => [rottenTomatoes(9.1)],
      limit: 2,
    })
    const { sweep } = sweepWith({ omdb: OMDB_OFF().source, mdblist: mdblist.source })

    sweep.kick()
    await sweep.whenIdle()

    expect(mdblist.lookUp).toHaveBeenCalledTimes(2)
    expect(isStamped(titles)).toEqual([true, true, false])
    expect(sweep.pause()).toEqual({ reason: 'budget', resumesAt: MIDNIGHT })

    await vi.advanceTimersByTimeAsync(untilJustBefore(MIDNIGHT))
    expect(mdblist.lookUp).toHaveBeenCalledTimes(2)

    await vi.advanceTimersByTimeAsync(1000)
    await sweep.whenIdle()
    expect(mdblist.lookUp).toHaveBeenCalledTimes(3)
    expect(isStamped(titles)).toEqual([true, true, true])
    expect(sweep.pause()).toBeNull()
  })

  it("hands over to OMDb once MDBList's day is spent, and waits for midnight only once both are", async () => {
    fakeClock()
    const titles = movies(['1', '2', '3'])
    const mdblist = fakeSource({
      provider: 'mdblist',
      answer: () => [rottenTomatoes(9.1)],
      limit: 1,
    })
    const omdb = fakeSource({ provider: 'omdb', answer: () => [rottenTomatoes(5)], limit: 1 })
    const { sweep } = sweepWith({ omdb: omdb.source, mdblist: mdblist.source })

    sweep.kick()
    await sweep.whenIdle()

    expect(titles.map((itemId) => rows(itemId).map((row) => row.provider))).toEqual([
      ['mdblist'],
      ['omdb'],
      [],
    ])
    expect(sweep.pause()).toEqual({ reason: 'budget', resumesAt: MIDNIGHT })
  })

  it('takes a source saying its day is spent as the budget, not a failure', async () => {
    fakeClock()
    movies(['1'])
    const mdblist = fakeSource({ provider: 'mdblist', answer: () => [] })
    mdblist.state.answer = () => {
      mdblist.spend()
      return new Error("MDBList's daily limit is spent: Daily API limit exceeded!")
    }
    const { sweep } = sweepWith({ omdb: OMDB_OFF().source, mdblist: mdblist.source })

    sweep.kick()
    await sweep.whenIdle()

    expect(sweep.pause()).toEqual({ reason: 'budget', resumesAt: MIDNIGHT })
  })

  it("wakes after midnight for a show MDBList's spent day left, while OMDb still has calls", async () => {
    fakeClock()
    const movie = title({ tmdbId: '1' })
    const show = title({ type: 'show', tmdbId: '2', imdbId: null })
    const mdblist = fakeSource({
      provider: 'mdblist',
      answer: () => [rottenTomatoes(9.1)],
      limit: 1,
    })
    const omdb = fakeSource({ provider: 'omdb', answer: () => [rottenTomatoes(5)] })
    const { sweep } = sweepWith({ omdb: omdb.source, mdblist: mdblist.source })

    sweep.kick()
    await sweep.whenIdle()

    expect(askedFor(mdblist.lookUp)).toEqual(['1'])
    expect(omdb.lookUp).not.toHaveBeenCalled()
    expect(isStamped([movie, show])).toEqual([true, false])
    expect(sweep.pause()).toBeNull()

    await vi.advanceTimersByTimeAsync(untilJustBefore(MIDNIGHT))
    expect(mdblist.lookUp).toHaveBeenCalledOnce()

    await vi.advanceTimersByTimeAsync(1000)
    await sweep.whenIdle()
    expect(askedFor(mdblist.lookUp)).toEqual(['1', '2'])
    expect(isStamped([movie, show])).toEqual([true, true])
    expect(sweep.pause()).toBeNull()
  })

  it("wakes after midnight for OMDb's fallback when its day is spent, while MDBList still has calls", async () => {
    fakeClock()
    const titles = movies(['1', '2'])
    const mdblist = fakeSource({ provider: 'mdblist', answer: () => 'unknown' })
    const omdb = fakeSource({ provider: 'omdb', answer: () => [rottenTomatoes(5)], limit: 1 })
    const { sweep } = sweepWith({ omdb: omdb.source, mdblist: mdblist.source })

    sweep.kick()
    await sweep.whenIdle()

    expect(mdblist.lookUp).toHaveBeenCalledTimes(2)
    expect(omdb.lookUp).toHaveBeenCalledOnce()
    expect(titles.map((itemId) => rows(itemId).length).toSorted()).toEqual([0, 1])
    expect(sweep.pause()).toBeNull()

    await vi.advanceTimersByTimeAsync(untilJustBefore(MIDNIGHT))
    expect(omdb.lookUp).toHaveBeenCalledOnce()

    await vi.advanceTimersByTimeAsync(1000)
    await sweep.whenIdle()
    expect(omdb.lookUp).toHaveBeenCalledTimes(2)
    expect(mdblist.lookUp).toHaveBeenCalledTimes(2)
    expect(titles.map((itemId) => rows(itemId).map((row) => row.provider))).toEqual([
      ['omdb'],
      ['omdb'],
    ])
    expect(sweep.pause()).toBeNull()
  })

  it('goes on past a title that keeps failing, asks it once a drain, and again on the next', async () => {
    fakeClock()
    const titles = movies(['1', '2', '3', '4'])
    const mdblist = fakeSource({
      provider: 'mdblist',
      answer: ({ tmdbId }) =>
        tmdbId === '1' ? new Error('MDBList answered 500.') : [rottenTomatoes(9.1)],
    })
    const { sweep } = sweepWith({ omdb: OMDB_OFF().source, mdblist: mdblist.source })

    sweep.kick()
    await sweep.whenIdle()

    expect(isStamped(titles)).toEqual([false, true, true, true])
    expect(askedFor(mdblist.lookUp).toSorted()).toEqual(['1', '2', '3', '4'])
    expect(sweep.pause()).toEqual({
      reason: 'unavailable',
      resumesAt: new Date(Date.now() + RETRY_MS).toISOString(),
    })

    sweep.kick()
    await sweep.whenIdle()
    expect(askedFor(mdblist.lookUp).slice(4)).toEqual(['1'])
  })

  it('reaches the titles behind four that keep failing, asking each of those once a drain', async () => {
    fakeClock()
    const titles = movies(['1', '2', '3', '4', '5', '6', '7', '8'])
    const failing = new Set(['1', '2', '3', '4'])
    const mdblist = fakeSource({
      provider: 'mdblist',
      answer: ({ tmdbId }) =>
        failing.has(tmdbId) ? new Error('MDBList answered 500.') : [rottenTomatoes(9.1)],
    })
    const { sweep } = sweepWith({ omdb: OMDB_OFF().source, mdblist: mdblist.source })

    sweep.kick()
    await sweep.whenIdle()

    expect(isStamped(titles)).toEqual([false, false, false, false, true, true, true, true])
    expect(askedFor(mdblist.lookUp).toSorted()).toEqual(['1', '2', '3', '4', '5', '6', '7', '8'])
    expect(sweep.pause()).toEqual({
      reason: 'unavailable',
      resumesAt: new Date(Date.now() + RETRY_MS).toISOString(),
    })

    await vi.advanceTimersByTimeAsync(RETRY_MS)
    await sweep.whenIdle()
    expect(askedFor(mdblist.lookUp).slice(8).toSorted()).toEqual(['1', '2', '3', '4'])
    expect(isStamped(titles)).toEqual([false, false, false, false, true, true, true, true])
  })

  it('takes a source as down after two rounds in a row with no answer, and tries again 15 minutes later', async () => {
    fakeClock()
    const titles = movies(['1', '2', '3', '4', '5', '6', '7', '8', '9', '10'])
    const mdblist = fakeSource({
      provider: 'mdblist',
      answer: () => new Error('MDBList could not be reached.'),
    })
    const { sweep } = sweepWith({ omdb: OMDB_OFF().source, mdblist: mdblist.source })

    sweep.kick()
    await sweep.whenIdle()

    // Each round ends at the third failure in a row, with the call beside it already in flight.
    expect(GIVE_UP_AFTER).toBe(3)
    expect(askedFor(mdblist.lookUp)).toEqual(['1', '2', '3', '4', '5', '6', '7', '8'])
    expect(isStamped(titles).some((isDone) => isDone)).toBe(false)
    expect(sweep.pause()).toEqual({
      reason: 'unavailable',
      resumesAt: new Date(Date.now() + RETRY_MS).toISOString(),
    })

    mdblist.state.answer = () => [rottenTomatoes(9.1)]
    await vi.advanceTimersByTimeAsync(RETRY_MS - 1000)
    expect(mdblist.lookUp).toHaveBeenCalledTimes(8)

    await vi.advanceTimersByTimeAsync(1000)
    await sweep.whenIdle()
    expect(isStamped(titles).every((isDone) => isDone)).toBe(true)
    expect(sweep.pause()).toBeNull()
  })

  it('skips a title scored since its round began', async () => {
    const [first = -1, second = -1, third = -1] = movies(['1', '2', '3'])
    const mdblist = fakeSource({ provider: 'mdblist', answer: () => [rottenTomatoes(9.1)] })
    const { sweep, repository } = sweepWith({ omdb: OMDB_OFF().source, mdblist: mdblist.source })
    const letGo = mdblist.hold()

    sweep.kick()
    expect(askedFor(mdblist.lookUp)).toEqual(['1', '2'])
    // As a match or Refresh details would, while the sweep waits on the first two.
    repository.saveScores({
      itemId: third,
      provider: 'mdblist',
      scores: [rottenTomatoes(7)],
    })
    letGo()
    await sweep.whenIdle()

    expect(askedFor(mdblist.lookUp)).toEqual(['1', '2'])
    expect([first, second, third].map((itemId) => rows(itemId)[0]?.value)).toEqual([9.1, 9.1, 7])
  })

  it('does nothing for a kick after shutdown', async () => {
    movies(['1'])
    const mdblist = fakeSource({ provider: 'mdblist', answer: () => [rottenTomatoes(9.1)] })
    const { sweep } = sweepWith({ omdb: OMDB_OFF().source, mdblist: mdblist.source })

    sweep.onModuleDestroy()
    sweep.kick()
    await sweep.whenIdle()

    expect(mdblist.lookUp).not.toHaveBeenCalled()
  })

  it('follows a drain kicked while it runs with exactly one more', async () => {
    const [only = -1] = movies(['1'])
    const mdblist = fakeSource({ provider: 'mdblist', answer: () => [rottenTomatoes(9.1)] })
    const { sweep, repository } = sweepWith({ omdb: OMDB_OFF().source, mdblist: mdblist.source })
    const lists = vi.spyOn(repository, 'scoresDue')
    const letGo = mdblist.hold()

    sweep.kick()
    expect(mdblist.lookUp).toHaveBeenCalledOnce()
    sweep.kick()
    sweep.kick()
    sweep.kick()
    letGo()
    await sweep.whenIdle()

    // The first drain lists the title, then nothing left; the one after it lists nothing once.
    expect(lists).toHaveBeenCalledTimes(3)
    expect(mdblist.lookUp).toHaveBeenCalledOnce()
    expect(isStamped([only])).toEqual([true])
  })

  it('pauses as unavailable when the drain itself throws, and drains on the next kick', async () => {
    fakeClock()
    const titles = movies(['1', '2'])
    const mdblist = fakeSource({ provider: 'mdblist', answer: () => [rottenTomatoes(9.1)] })
    const { sweep, repository } = sweepWith({ omdb: OMDB_OFF().source, mdblist: mdblist.source })
    vi.spyOn(repository, 'scoresDue').mockImplementationOnce(() => {
      throw new Error('database is locked')
    })

    sweep.kick()
    await sweep.whenIdle()

    expect(mdblist.lookUp).not.toHaveBeenCalled()
    expect(sweep.pause()).toEqual({
      reason: 'unavailable',
      resumesAt: new Date(Date.now() + RETRY_MS).toISOString(),
    })

    sweep.kick()
    await sweep.whenIdle()
    expect(isStamped(titles)).toEqual([true, true])
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
