import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Logger } from '@nestjs/common'
import type { NestFastifyApplication } from '@nestjs/platform-fastify'
import { isMediaList } from '@raven/core'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { createApp } from '@/app'
import { DatabaseService } from '@/db/database'
import { LibrariesRepository } from '@/libraries/librariesRepository'
import { RatingsRefresh } from '@/libraries/ratingsRefresh'
import { MediaIndex } from '@/media/mediaIndex'
import { ItemRefresher } from '@/metadata/itemRefresher'
import { MetadataService } from '@/metadata/metadataService'
import type { ExternalScore, ScoreProvider, ScoreSource, ScoreTitle } from '@/metadata/scoreSources'
import { Scores } from '@/metadata/scores'
import {
  GIVE_UP_AFTER,
  REQUEST_PATIENCE_MS,
  REQUEST_TRIES,
  RETRY_MS,
  ScoreSweep,
} from '@/metadata/scoreSweep'
import { BLANK_ITEM, type MetadataFetch, type TmdbClient, TmdbError } from '@/metadata/tmdbClient'
import { ScannerService } from '@/scanner/scannerService'
import { adminCookie, holdOpen, NOT_WATCHING, testConfig } from '@/test/app'
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
 * hold the calls in flight. `spend` uses the day up, as a source told so
 * does, and `refuse` turns it off with calls left, as a refused key does.
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
    isRefused: false,
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
  const refuse = (): void => {
    state.isRefused = true
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
    enabled: () => hasKey && !state.isRefused && usedToday() < limit,
    hasUsableKey: () => hasKey && !state.isRefused,
    remaining: () => Math.max(0, limit - usedToday()),
    state: () => {
      if (!hasKey) return 'off'
      return state.isRefused ? 'failing' : 'ok'
    },
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
  return { source, lookUp, state, spend, refuse, hold }
}

const rottenTomatoes = (value: number): ExternalScore => ({
  source: 'rottenTomatoes',
  value,
  votes: null,
})

const imdb = (value: number): ExternalScore => ({ source: 'imdb', value, votes: 100 })

const OMDB_OFF = () => fakeSource({ provider: 'omdb', answer: () => [], hasKey: false })

const MDBLIST_OFF = () => fakeSource({ provider: 'mdblist', answer: () => [], hasKey: false })

/** TMDB's own score for any title, as a Refresh fetches it beside the others. */
const tmdbAnswering = () => vi.fn<TmdbClient['score']>(async () => ({ value: 7.5, votes: 40 }))

/** The TMDB ids a source was asked about, in order. */
const askedFor = (lookUp: ReturnType<typeof fakeSource>['lookUp']): string[] =>
  lookUp.mock.calls.map(([title]) => title.tmdbId)

describe('the score sweep', () => {
  const database = testDatabase('raven-score-sweep-')
  const metadata = () => repositories(database.get()).metadata
  const sweeps: ScoreSweep[] = []
  const sweepWith = ({
    omdb,
    mdblist,
    tmdb = { score: tmdbAnswering(), enabled: true },
  }: {
    omdb: ScoreSource
    mdblist: ScoreSource
    tmdb?: { score: ReturnType<typeof tmdbAnswering>; enabled: boolean }
  }) => {
    const repository = metadata()
    const libraries = new LibrariesRepository(database.get())
    const sweep = new ScoreSweep(repository, new Scores(repository, omdb, mdblist), libraries, tmdb)
    sweeps.push(sweep)
    return { sweep, repository, libraries, tmdbScore: tmdb.score }
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
  const stampMdblist = ({ itemId, at }: { itemId: number; at: string }) =>
    database
      .get()
      .db.prepare('UPDATE items SET mdblist_fetched_at = ? WHERE id = ?')
      .run(at, itemId)
  const tmdbScoreOf = (itemId: number): number | null =>
    database
      .get()
      .db.prepare<[number], { value: number }>(
        "SELECT value FROM ratings WHERE item_id = ? AND source = 'tmdb'",
      )
      .get(itemId)?.value ?? null
  /** A library holding `itemIds`, each in a file of its own. */
  const libraryHolding = (itemIds: number[]): number => {
    const libraries = new LibrariesRepository(database.get())
    const index = new MediaIndex(database.get())
    const { id } = libraries.create({
      name: 'Films',
      paths: ['/films'],
      settings: { kind: 'movies' },
    })
    itemIds.forEach((itemId) =>
      metadata().link({
        mediaIds: [
          index.insert({
            libraryId: id,
            kind: 'movies',
            file: { path: `/films/${itemId}.mkv`, root: '/films', size: 1, mtimeMs: 1 },
          }),
        ],
        itemIds: [itemId],
      }),
    )
    return id
  }
  /** A library holding `itemIds` whose Refresh asked for them now, as `RatingsRefresh.start` leaves it. */
  const refresh = (itemIds: number[]): number => {
    const id = libraryHolding(itemIds)
    new LibrariesRepository(database.get()).startRatingsRefresh({
      id,
      at: new Date().toISOString(),
      shouldAsk: true,
    })
    return id
  }
  const DOWN = () => new Error('MDBList could not be reached.')
  const isFinished = (libraryId: number): boolean => {
    const { startedAt, finishedAt } = new LibrariesRepository(database.get()).ratingsRefresh(
      libraryId,
    )
    return startedAt == null && finishedAt != null
  }
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
    database.get().db.prepare('DELETE FROM libraries').run()
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

  it('leaves a title that keeps failing to the next kick once the rest answered, and asks it then', async () => {
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
    expect(sweep.pause()).toBeNull()

    await vi.advanceTimersByTimeAsync(2 * RETRY_MS)
    expect(mdblist.lookUp).toHaveBeenCalledTimes(4)

    // The drain got answers from MDBList, so it forgot the failure.
    sweep.kick()
    await sweep.whenIdle()
    expect(askedFor(mdblist.lookUp).slice(4)).toEqual(['1'])
  })

  it('waits for the next kick after a drain that answered and then got none, and asks its failures again then', async () => {
    fakeClock()
    const titles = movies(['1', '2', '3', '4', '5', '6', '7', '8'])
    const mdblist = fakeSource({
      provider: 'mdblist',
      answer: ({ tmdbId }) =>
        tmdbId === '1' ? [rottenTomatoes(9.1)] : new Error('MDBList answered 500.'),
    })
    const { sweep } = sweepWith({ omdb: OMDB_OFF().source, mdblist: mdblist.source })

    sweep.kick()
    await sweep.whenIdle()

    // The first round answers for 1; the second, past the titles that failed, gets no answer.
    expect(mdblist.lookUp).toHaveBeenCalledTimes(8)
    expect(isStamped(titles)).toEqual([true, ...Array.from({ length: 7 }, () => false)])
    expect(sweep.pause()).toBeNull()

    await vi.advanceTimersByTimeAsync(2 * RETRY_MS)
    expect(mdblist.lookUp).toHaveBeenCalledTimes(8)

    sweep.kick()
    await sweep.whenIdle()
    expect(askedFor(mdblist.lookUp).slice(8).toSorted()).toEqual(['2', '3', '4', '5'])
  })

  it('reaches the titles behind eight that keep failing within two silent drains, asking each once a drain', async () => {
    fakeClock()
    const titles = movies(['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12'])
    const failing = new Set(['1', '2', '3', '4', '5', '6', '7', '8'])
    const mdblist = fakeSource({
      provider: 'mdblist',
      answer: ({ tmdbId }) =>
        failing.has(tmdbId) ? new Error('MDBList answered 500.') : [rottenTomatoes(9.1)],
    })
    const { sweep } = sweepWith({ omdb: OMDB_OFF().source, mdblist: mdblist.source })
    const askedSince = (calls: number) => askedFor(mdblist.lookUp).slice(calls).toSorted()
    const unavailable = () => ({
      reason: 'unavailable',
      resumesAt: new Date(Date.now() + RETRY_MS).toISOString(),
    })

    sweep.kick()
    await sweep.whenIdle()
    expect(askedSince(0)).toEqual(['1', '2', '3', '4'])
    expect(sweep.pause()).toEqual(unavailable())

    await vi.advanceTimersByTimeAsync(RETRY_MS)
    await sweep.whenIdle()
    expect(askedSince(4)).toEqual(['5', '6', '7', '8'])
    expect(sweep.pause()).toEqual(unavailable())

    await vi.advanceTimersByTimeAsync(RETRY_MS)
    await sweep.whenIdle()
    expect(askedSince(8)).toEqual(['9', '10', '11', '12'].toSorted())
    expect(isStamped(titles).slice(8)).toEqual([true, true, true, true])
    expect(sweep.pause()).toBeNull()
  })

  it('spends at most four calls a try on a source that is down', async () => {
    fakeClock()
    const titles = movies(['1', '2', '3', '4', '5', '6', '7', '8', '9', '10'])
    const mdblist = fakeSource({
      provider: 'mdblist',
      answer: () => new Error('MDBList could not be reached.'),
    })
    const { sweep } = sweepWith({ omdb: OMDB_OFF().source, mdblist: mdblist.source })

    sweep.kick()
    await sweep.whenIdle()

    // A round ends at the third failure in a row, with the call beside it already in flight.
    expect(GIVE_UP_AFTER).toBe(3)
    expect(askedFor(mdblist.lookUp)).toEqual(['1', '2', '3', '4'])
    expect(sweep.pause()).toEqual({
      reason: 'unavailable',
      resumesAt: new Date(Date.now() + RETRY_MS).toISOString(),
    })

    await vi.advanceTimersByTimeAsync(RETRY_MS - 1000)
    expect(mdblist.lookUp).toHaveBeenCalledTimes(4)

    await vi.advanceTimersByTimeAsync(1000)
    await sweep.whenIdle()
    expect(askedFor(mdblist.lookUp).slice(4)).toEqual(['5', '6', '7', '8'])

    mdblist.state.answer = () => [rottenTomatoes(9.1)]
    await vi.advanceTimersByTimeAsync(RETRY_MS)
    await sweep.whenIdle()
    expect(askedFor(mdblist.lookUp).slice(8)).toEqual(['9', '10'])
    expect(isStamped(titles)).toEqual([...Array.from({ length: 8 }, () => false), true, true])
  })

  it('forgets the failures once every due title has failed, so the next drain asks them again', async () => {
    fakeClock()
    movies(['1', '2', '3'])
    const mdblist = fakeSource({
      provider: 'mdblist',
      answer: () => new Error('MDBList could not be reached.'),
    })
    const { sweep } = sweepWith({ omdb: OMDB_OFF().source, mdblist: mdblist.source })

    sweep.kick()
    await sweep.whenIdle()
    expect(mdblist.lookUp).toHaveBeenCalledTimes(3)
    expect(sweep.pause()?.reason).toBe('unavailable')

    await vi.advanceTimersByTimeAsync(RETRY_MS)
    await sweep.whenIdle()
    expect(mdblist.lookUp).toHaveBeenCalledTimes(3)
    expect(sweep.pause()).toBeNull()

    await vi.advanceTimersByTimeAsync(2 * RETRY_MS)
    expect(mdblist.lookUp).toHaveBeenCalledTimes(3)

    sweep.kick()
    await sweep.whenIdle()
    expect(askedFor(mdblist.lookUp).slice(3)).toEqual(['1', '2', '3'])
  })

  it('asks OMDb in the same drain for a title MDBList could not answer', async () => {
    const [failed = -1, answered = -1] = movies(['1', '2'])
    const mdblist = fakeSource({
      provider: 'mdblist',
      answer: ({ tmdbId }) =>
        tmdbId === '1' ? new Error('MDBList answered 500.') : [rottenTomatoes(9.1)],
    })
    const omdb = fakeSource({ provider: 'omdb', answer: () => [rottenTomatoes(5)] })
    const { sweep } = sweepWith({ omdb: omdb.source, mdblist: mdblist.source })

    sweep.kick()
    await sweep.whenIdle()

    expect(askedFor(omdb.lookUp)).toEqual(['1'])
    expect(rows(failed)).toEqual([{ source: 'rottenTomatoes', value: 5, provider: 'omdb' }])
    expect(rows(answered)).toEqual([{ source: 'rottenTomatoes', value: 9.1, provider: 'mdblist' }])
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

  it('hands over to OMDb in the same drain when MDBList refuses the key', async () => {
    const titles = movies(['1', '2', '3'])
    const mdblist = fakeSource({
      provider: 'mdblist',
      answer: () => new Error('MDBList refused the key (401).'),
    })
    const omdb = fakeSource({ provider: 'omdb', answer: () => [rottenTomatoes(5)] })
    const { sweep } = sweepWith({ omdb: omdb.source, mdblist: mdblist.source })
    const letGo = mdblist.hold()

    sweep.kick()
    expect(mdblist.lookUp).toHaveBeenCalledTimes(2)
    mdblist.refuse()
    letGo()
    await sweep.whenIdle()

    expect(askedFor(omdb.lookUp).toSorted()).toEqual(['1', '2', '3'])
    expect(titles.map((itemId) => rows(itemId).map((row) => row.provider))).toEqual([
      ['omdb'],
      ['omdb'],
      ['omdb'],
    ])
    expect(sweep.pause()).toBeNull()
  })

  it('starts no call and reads nothing more once the app shuts down mid-drain', async () => {
    movies(['1', '2', '3', '4'])
    const mdblist = fakeSource({ provider: 'mdblist', answer: () => [rottenTomatoes(9.1)] })
    const { sweep, repository } = sweepWith({ omdb: OMDB_OFF().source, mdblist: mdblist.source })
    const letGo = mdblist.hold()

    sweep.kick()
    expect(mdblist.lookUp).toHaveBeenCalledTimes(2)
    const lists = vi.spyOn(repository, 'scoresDue')
    sweep.onModuleDestroy()
    letGo()
    await sweep.whenIdle()

    expect(mdblist.lookUp).toHaveBeenCalledTimes(2)
    expect(lists).not.toHaveBeenCalled()
    expect(sweep.pause()).toBeNull()
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

  it("asks first for the titles a Refresh asked for, past the 30-day wait, with TMDB's own score", async () => {
    fakeClock()
    const [fresh = -1, requested = -1, never = -1] = movies(['1', '2', '3'])
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
    stampMdblist({ itemId: fresh, at: yesterday })
    stampMdblist({ itemId: requested, at: yesterday })
    const libraryId = refresh([requested])
    const mdblist = fakeSource({
      provider: 'mdblist',
      answer: () => [rottenTomatoes(9.1)],
      limit: 1,
    })
    const { sweep, tmdbScore } = sweepWith({ omdb: OMDB_OFF().source, mdblist: mdblist.source })

    sweep.kick()
    await sweep.whenIdle()

    // The title never asked about would come first, but for the one a Refresh asked for.
    expect(askedFor(mdblist.lookUp)).toEqual(['2'])
    expect(tmdbScore.mock.calls.map(([asked]) => asked.tmdbId)).toEqual(['2'])
    expect([fresh, requested, never].map(tmdbScoreOf)).toEqual([null, 7.5, null])
    expect(rows(requested)).toEqual([{ source: 'rottenTomatoes', value: 9.1, provider: 'mdblist' }])
    expect(metadata().requestsLeft(libraryId)).toBe(0)
    expect(isFinished(libraryId)).toBe(true)
  })

  it("keeps a request OMDb answers while MDBList is only out of calls, and settles it with MDBList's answer after midnight UTC", async () => {
    fakeClock()
    const shows = ['1', '2', '3'].map((tmdbId) => title({ type: 'show', tmdbId }))
    const libraryId = refresh(shows)
    const mdblist = fakeSource({
      provider: 'mdblist',
      answer: () => [rottenTomatoes(9.1)],
      limit: 2,
    })
    const omdb = fakeSource({ provider: 'omdb', answer: () => [imdb(8)] })
    const { sweep } = sweepWith({ omdb: omdb.source, mdblist: mdblist.source })

    sweep.kick()
    await sweep.whenIdle()

    expect(mdblist.lookUp).toHaveBeenCalledTimes(2)
    const [third = ''] = askedFor(omdb.lookUp)
    expect(askedFor(mdblist.lookUp)).not.toContain(third)
    expect(metadata().requestsLeft(libraryId)).toBe(1)
    expect(isFinished(libraryId)).toBe(false)
    expect(sweep.pause()).toBeNull()
    expect(sweep.requestsPause()).toEqual({ reason: 'budget', resumesAt: MIDNIGHT })

    await vi.advanceTimersByTimeAsync(untilJustBefore(MIDNIGHT) + 1000)
    await sweep.whenIdle()
    expect(askedFor(mdblist.lookUp).slice(2)).toEqual([third])
    expect(omdb.lookUp).toHaveBeenCalledOnce()
    expect(metadata().requestsLeft(libraryId)).toBe(0)
    expect(isFinished(libraryId)).toBe(true)
    expect(sweep.requestsPause()).toBeNull()
  })

  it("settles a request with OMDb's answer when MDBList has no key", async () => {
    const [only = -1] = movies(['1'])
    const libraryId = refresh([only])
    const omdb = fakeSource({ provider: 'omdb', answer: () => [rottenTomatoes(5)] })
    const { sweep } = sweepWith({ omdb: omdb.source, mdblist: MDBLIST_OFF().source })

    sweep.kick()
    await sweep.whenIdle()

    expect(askedFor(omdb.lookUp)).toEqual(['1'])
    expect(metadata().requestsLeft(libraryId)).toBe(0)
    expect(isFinished(libraryId)).toBe(true)
  })

  it("settles a request with TMDB's score alone when no score source has a key", async () => {
    const [only = -1] = movies(['1'])
    const libraryId = refresh([only])
    const { sweep, tmdbScore } = sweepWith({
      omdb: OMDB_OFF().source,
      mdblist: MDBLIST_OFF().source,
    })

    sweep.kick()
    await sweep.whenIdle()

    expect(tmdbScore).toHaveBeenCalledOnce()
    expect(tmdbScoreOf(only)).toBe(7.5)
    expect(metadata().requestsLeft(libraryId)).toBe(0)
    expect(isFinished(libraryId)).toBe(true)
    expect(sweep.pause()).toBeNull()
  })

  it('asks a requested title that failed again 15 minutes later, and finishes once it answers', async () => {
    fakeClock()
    const titles = movies(['1', '2', '3'])
    const libraryId = refresh(titles)
    const mdblist = fakeSource({
      provider: 'mdblist',
      answer: ({ tmdbId }) =>
        tmdbId === '1' ? new Error('MDBList answered 500.') : [rottenTomatoes(9.1)],
    })
    const { sweep } = sweepWith({ omdb: OMDB_OFF().source, mdblist: mdblist.source })

    sweep.kick()
    await sweep.whenIdle()

    expect(askedFor(mdblist.lookUp).toSorted()).toEqual(['1', '2', '3'])
    expect(metadata().requestsLeft(libraryId)).toBe(1)
    expect(sweep.requestsPause()).toEqual({
      reason: 'unavailable',
      resumesAt: new Date(Date.now() + RETRY_MS).toISOString(),
    })

    mdblist.state.answer = () => [rottenTomatoes(9.1)]
    await vi.advanceTimersByTimeAsync(RETRY_MS - 1000)
    expect(mdblist.lookUp).toHaveBeenCalledTimes(3)

    await vi.advanceTimersByTimeAsync(1000)
    await sweep.whenIdle()
    expect(askedFor(mdblist.lookUp).slice(3)).toEqual(['1'])
    expect(metadata().requestsLeft(libraryId)).toBe(0)
    expect(isFinished(libraryId)).toBe(true)

    await vi.advanceTimersByTimeAsync(2 * RETRY_MS)
    expect(mdblist.lookUp).toHaveBeenCalledTimes(4)
  })

  it('gives up a requested title MDBList always fails on only after a day, keeping its scores, and finishes', async () => {
    fakeClock()
    const [failing = -1, other = -1] = movies(['1', '2'])
    metadata().saveScores({ itemId: failing, provider: 'mdblist', scores: [rottenTomatoes(7)] })
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
    stampMdblist({ itemId: failing, at: yesterday })
    stampMdblist({ itemId: other, at: yesterday })
    const libraryId = refresh([failing, other])
    const mdblist = fakeSource({
      provider: 'mdblist',
      answer: ({ tmdbId }) =>
        tmdbId === '1' ? new Error('MDBList answered 500.') : [rottenTomatoes(9.1)],
    })
    const { sweep } = sweepWith({ omdb: OMDB_OFF().source, mdblist: mdblist.source })
    const tries = () => askedFor(mdblist.lookUp).filter((tmdbId) => tmdbId === '1').length

    sweep.kick()
    await sweep.whenIdle()
    expect(tries()).toBe(1)

    // Asked 15 minutes after a drain that answered, 30 after one that did not.
    await vi.advanceTimersByTimeAsync(REQUEST_PATIENCE_MS - RETRY_MS)
    expect(tries()).toBeGreaterThan(REQUEST_TRIES)
    expect(metadata().requestsLeft(libraryId)).toBe(1)

    await vi.advanceTimersByTimeAsync(2 * RETRY_MS)
    await sweep.whenIdle()
    expect(metadata().requestsLeft(libraryId)).toBe(0)
    expect(isFinished(libraryId)).toBe(true)
    expect(rows(failing)).toEqual([{ source: 'rottenTomatoes', value: 7, provider: 'mdblist' }])

    const given = tries()
    await vi.advanceTimersByTimeAsync(4 * RETRY_MS)
    expect(tries()).toBe(given)
    expect(sweep.requestsPause()).toBeNull()
  })

  it('gives nothing up through a two-hour outage, and settles once MDBList answers again', async () => {
    fakeClock()
    const titles = movies(['1', '2'])
    const libraryId = refresh(titles)
    const mdblist = fakeSource({ provider: 'mdblist', answer: DOWN })
    const { sweep } = sweepWith({ omdb: OMDB_OFF().source, mdblist: mdblist.source })

    sweep.kick()
    await sweep.whenIdle()
    await vi.advanceTimersByTimeAsync(2 * 60 * 60 * 1000)
    expect(mdblist.lookUp.mock.calls.length).toBeGreaterThan(2 * REQUEST_TRIES)
    expect(metadata().requestsLeft(libraryId)).toBe(2)

    mdblist.state.answer = () => [rottenTomatoes(9.1)]
    await vi.advanceTimersByTimeAsync(2 * RETRY_MS)
    await sweep.whenIdle()
    expect(metadata().requestsLeft(libraryId)).toBe(0)
    expect(isFinished(libraryId)).toBe(true)
  })

  it('gives nothing up for presses close together while MDBList is down', async () => {
    fakeClock()
    const titles = movies(['1', '2'])
    const libraryId = libraryHolding(titles)
    const mdblist = fakeSource({ provider: 'mdblist', answer: DOWN })
    const { sweep, repository, libraries } = sweepWith({
      omdb: OMDB_OFF().source,
      mdblist: mdblist.source,
    })
    const refreshing = new RatingsRefresh(
      libraries,
      repository,
      { quickScan: vi.fn(), cancel: vi.fn() },
      sweep,
    )

    await Array.from({ length: 8 }).reduce<Promise<void>>(
      (pressed) =>
        pressed.then(() => {
          refreshing.start(libraryId)
          return sweep.whenIdle()
        }),
      Promise.resolve(),
    )

    expect(mdblist.lookUp.mock.calls.length).toBeGreaterThan(2 * REQUEST_TRIES)
    expect(repository.requestsLeft(libraryId)).toBe(2)
    expect(refreshing.status(libraryId)).toMatchObject({
      state: 'waiting',
      done: 0,
      total: 2,
      reason: 'unavailable',
    })
  })

  it("says a Refresh waits for midnight UTC while MDBList's day is spent, though OMDb is down", async () => {
    fakeClock()
    refresh(movies(['1']))
    const mdblist = fakeSource({ provider: 'mdblist', answer: () => [rottenTomatoes(9.1)] })
    mdblist.spend()
    const omdb = fakeSource({ provider: 'omdb', answer: () => new Error('OMDb answered 500.') })
    const { sweep } = sweepWith({ omdb: omdb.source, mdblist: mdblist.source })

    sweep.kick()
    await sweep.whenIdle()

    expect(omdb.lookUp).toHaveBeenCalledOnce()
    expect(sweep.pause()?.reason).toBe('unavailable')
    expect(sweep.requestsPause()).toEqual({ reason: 'budget', resumesAt: MIDNIGHT })
  })

  it('fetches no TMDB score while TMDB is off or refused, and logs nothing for it', async () => {
    const [only = -1] = movies(['1'])
    const libraryId = refresh([only])
    const mdblist = fakeSource({ provider: 'mdblist', answer: () => [rottenTomatoes(9.1)] })
    const score = vi.fn<TmdbClient['score']>(async () => {
      throw new TmdbError({ kind: 'unauthorized', message: 'TMDB is not configured.' })
    })
    const warn = vi.spyOn(Logger.prototype, 'warn')
    const { sweep } = sweepWith({
      omdb: OMDB_OFF().source,
      mdblist: mdblist.source,
      tmdb: { score, enabled: false },
    })

    sweep.kick()
    await sweep.whenIdle()

    expect(score).not.toHaveBeenCalled()
    expect(warn).not.toHaveBeenCalled()
    expect(metadata().requestsLeft(libraryId)).toBe(0)
    warn.mockRestore()
  })

  it("leaves a title to the next round when the other title's call spent MDBList's day while TMDB answered", async () => {
    const titles = movies(['1', '2'])
    const libraryId = refresh(titles)
    const events: string[] = []
    const gate = { isHeld: true, open: () => {} }
    const opened = new Promise<void>((resolve) => {
      gate.open = resolve
    })
    const score = vi.fn<TmdbClient['score']>(async ({ tmdbId }) => {
      events.push(`tmdb:${tmdbId}`)
      if (tmdbId === '1' && gate.isHeld) await opened
      return { value: 7.5, votes: 40 }
    })
    const mdblist = fakeSource({
      provider: 'mdblist',
      answer: ({ tmdbId }) => {
        events.push(`mdblist:${tmdbId}`)
        // This call is the day's last, as MDBList's own count of calls left can say.
        mdblist.spend()
        gate.isHeld = false
        gate.open()
        return [rottenTomatoes(9.1)]
      },
    })
    const omdb = fakeSource({
      provider: 'omdb',
      answer: ({ tmdbId }) => {
        events.push(`omdb:${tmdbId}`)
        return [imdb(8)]
      },
    })
    const { sweep } = sweepWith({
      omdb: omdb.source,
      mdblist: mdblist.source,
      tmdb: { score, enabled: true },
    })

    sweep.kick()
    await sweep.whenIdle()

    // The first title is asked in OMDb's own round, with TMDB's score fetched again.
    expect(events).toEqual(['tmdb:1', 'tmdb:2', 'mdblist:2', 'tmdb:1', 'omdb:1'])
    expect(metadata().requestsLeft(libraryId)).toBe(1)
  })

  it('stops every Refresh with one log line once no source can settle it', async () => {
    const titles = movies(['1', '2'])
    const libraryId = refresh(titles)
    // TMDB, the only source, has refused its token since the Refresh began.
    const tmdb = { score: tmdbAnswering(), enabled: false }
    const warn = vi.spyOn(Logger.prototype, 'warn')
    const { sweep } = sweepWith({
      omdb: OMDB_OFF().source,
      mdblist: MDBLIST_OFF().source,
      tmdb,
    })

    sweep.kick()
    await sweep.whenIdle()

    expect(tmdb.score).not.toHaveBeenCalled()
    expect(metadata().requestsLeft(libraryId)).toBe(0)
    expect(isFinished(libraryId)).toBe(true)
    expect(warn).toHaveBeenCalledOnce()
    warn.mockRestore()
  })

  it('asks once for a title two libraries hold, and finishes both Refreshes', async () => {
    const [shared = -1] = movies(['1'])
    const first = refresh([shared])
    const second = refresh([shared])
    const mdblist = fakeSource({ provider: 'mdblist', answer: () => [rottenTomatoes(9.1)] })
    const { sweep } = sweepWith({ omdb: OMDB_OFF().source, mdblist: mdblist.source })

    sweep.kick()
    await sweep.whenIdle()

    expect(mdblist.lookUp).toHaveBeenCalledOnce()
    expect([first, second].map(isFinished)).toEqual([true, true])
  })

  it("settles the requests OMDb answered once MDBList's key is refused", async () => {
    fakeClock()
    const titles = movies(['1', '2'])
    const libraryId = refresh(titles)
    const mdblist = fakeSource({
      provider: 'mdblist',
      answer: () => [rottenTomatoes(9.1)],
      limit: 1,
    })
    const omdb = fakeSource({ provider: 'omdb', answer: () => [rottenTomatoes(5)] })
    const { sweep } = sweepWith({ omdb: omdb.source, mdblist: mdblist.source })

    sweep.kick()
    await sweep.whenIdle()
    expect(omdb.lookUp).toHaveBeenCalledOnce()
    expect(metadata().requestsLeft(libraryId)).toBe(1)

    mdblist.refuse()
    sweep.kick()
    await sweep.whenIdle()

    expect(omdb.lookUp).toHaveBeenCalledOnce()
    expect(metadata().requestsLeft(libraryId)).toBe(0)
    expect(isFinished(libraryId)).toBe(true)
  })

  it('ends a drain whose round asks nothing while its source is still the one to ask', async () => {
    movies(['1', '2'])
    const mdblist = fakeSource({ provider: 'mdblist', answer: () => [rottenTomatoes(9.1)] })
    const { sweep, repository } = sweepWith({ omdb: OMDB_OFF().source, mdblist: mdblist.source })
    vi.spyOn(repository, 'isScoreDue').mockReturnValue(false)
    const lists = vi.spyOn(repository, 'scoresDue')

    sweep.kick()
    await sweep.whenIdle()

    expect(mdblist.lookUp).not.toHaveBeenCalled()
    expect(lists).toHaveBeenCalledOnce()
    expect(sweep.pause()).toBeNull()
  })
})

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

/** As a browser with the admin lock off, so the library can be added. */
describe('the score sweep after a matching pass', () => {
  const tmdb = fakeTmdb({
    movies: [
      { id: 949, title: 'Heat', released: '1995-12-15' },
      { id: 1538, title: 'Collateral', released: '2004-08-05' },
    ],
    mdblist: { 'movie:949': { rottenTomatoes: 87 }, 'movie:1538': { rottenTomatoes: 86 } },
  })
  const state: { root: string; app: NestFastifyApplication | null } = { root: '', app: null }
  const app = (): NestFastifyApplication => {
    if (!state.app) throw new Error('app not started')
    return state.app
  }

  beforeAll(async () => {
    state.root = await mkdtemp(join(tmpdir(), 'raven-score-sweep-pass-'))
    const media = join(state.root, 'media')
    await Promise.all([
      encodeClip({ path: join(media, 'Heat (1995).mp4'), seconds: 1 }),
      encodeClip({ path: join(media, 'Collateral (2004).mp4'), seconds: 1 }),
    ])
    state.app = await createApp({
      config: {
        ...testConfig({ dataDir: join(state.root, 'data'), mediaDir: state.root }),
        tmdbApiToken: 'test-token',
        mdblistApiKey: 'mdblist-key',
        mdblistDailyLimit: 1,
      },
      quiet: true,
      metadataFetch: tmdb.fetch,
      watch: NOT_WATCHING,
    })
    await state.app.init()
    const admin = await adminCookie(state.app)
    const created = await apiFor({ app: state.app, cookie: admin }).createLibrary({
      name: 'Films',
      paths: [media],
      settings: { kind: 'movies' },
    })
    await app().get(ScannerService).whenIdle(created.id)
    await app().get(MetadataService).whenIdle()
    await app().get(ScoreSweep).whenIdle()
    await app().get(ThumbnailService).whenIdle()
  })

  afterAll(async () => {
    await state.app?.close()
    await rm(state.root, { recursive: true, force: true })
  })

  it('wakes after midnight UTC when a matching pass spent the day', () => {
    expect(tmdb.state.mdblistCalls).toBe(1)
    expect(app().get(ScoreSweep).pause()).toEqual({
      reason: 'budget',
      resumesAt: expect.stringMatching(/T00:01:00\.000Z$/),
    })
  })
})
