import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { readServerConfig } from '@/config'
import { LibrariesRepository } from '@/libraries/librariesRepository'
import { RatingsRefresh } from '@/libraries/ratingsRefresh'
import { MediaIndex } from '@/media/mediaIndex'
import { MdblistClient } from '@/metadata/mdblistClient'
import { OmdbClient } from '@/metadata/omdbClient'
import { Scores } from '@/metadata/scores'
import { ScoreSweep } from '@/metadata/scoreSweep'
import { BLANK_ITEM, type MetadataFetch, TmdbClient } from '@/metadata/tmdbClient'
import type { ScannerService } from '@/scanner/scannerService'
import { testDatabase } from '@/test/database'
import { repositories } from '@/test/repositories'

/** TMDB turning the token down, as it does a wrong one. */
const refusing: MetadataFetch = async () =>
  new Response(JSON.stringify({ status_code: 7 }), { status: 401 })

describe("a library's Refresh", () => {
  const database = testDatabase('raven-ratings-refresh-')
  const libraries = () => new LibrariesRepository(database.get())
  const metadata = () => repositories(database.get()).metadata
  const scanner = () => ({
    quickScan: vi.fn<ScannerService['quickScan']>(),
    cancel: vi.fn<ScannerService['cancel']>(),
  })

  /** A movies library of its own, holding two movies, each in a file. */
  const library = (name: string): { id: number; itemIds: number[] } => {
    const { id } = libraries().create({ name, paths: [`/${name}`], settings: { kind: 'movies' } })
    const index = new MediaIndex(database.get())
    const itemIds = ['1', '2'].map((number) => {
      const itemId = metadata().save({
        item: {
          ...BLANK_ITEM,
          type: 'movie',
          tmdbId: `${name}-${number}`,
          number: null,
          title: `${name} ${number}`,
        },
      })
      metadata().link({
        mediaIds: [
          index.insert({
            libraryId: id,
            kind: 'movies',
            file: { path: `/${name}/${number}.mkv`, root: `/${name}`, size: 1, mtimeMs: 1 },
          }),
        ],
        itemIds: [itemId],
      })
      return itemId
    })
    return { id, itemIds }
  }

  /** The real sweep, with no score source that has a key, and `tmdb` for TMDB's own score. */
  const sweepWith = ({ tmdb }: { tmdb: TmdbClient }): ScoreSweep => {
    const config = readServerConfig({})
    const scores = new Scores(
      metadata(),
      new OmdbClient(config, refusing),
      new MdblistClient(config, refusing),
    )
    return new ScoreSweep(metadata(), scores, libraries(), tmdb)
  }

  beforeAll(() => database.open())
  afterAll(database.close)

  it('asks for nothing, and finishes at once, with no source at all', async () => {
    const { id } = library('Nothing')
    const sweep = sweepWith({
      tmdb: new TmdbClient({ ...readServerConfig({}), tmdbApiToken: null }, refusing),
    })
    const scanning = scanner()

    new RatingsRefresh(libraries(), metadata(), scanning, sweep).start(id)
    await sweep.whenIdle()
    sweep.onModuleDestroy()

    expect(scanning.quickScan).toHaveBeenCalledWith(id)
    expect(metadata().requestsLeft(id)).toBe(0)
    expect(libraries().ratingsRefresh(id)).toEqual({
      startedAt: null,
      total: 0,
      finishedAt: expect.any(String),
    })
  })

  it('asks for nothing, and finishes at once, with TMDB alone and its token refused', async () => {
    const { id } = library('Refused')
    const tmdb = new TmdbClient({ ...readServerConfig({}), tmdbApiToken: 'wrong-token' }, refusing)
    await expect(tmdb.score({ type: 'movie', tmdbId: '1' })).rejects.toThrow('refused')
    const sweep = sweepWith({ tmdb })
    const scanning = scanner()
    const refresh = new RatingsRefresh(libraries(), metadata(), scanning, sweep)

    refresh.start(id)
    await sweep.whenIdle()
    sweep.onModuleDestroy()

    expect(scanning.quickScan).toHaveBeenCalledWith(id)
    expect(metadata().requestsLeft(id)).toBe(0)
    expect(refresh.status(id)).toEqual({ state: 'idle', finishedAt: expect.any(String) })
  })

  it('finishes once the last title it waits on leaves outside the sweep', () => {
    const {
      id,
      itemIds: [deleted = -1, refreshed = -1],
    } = library('Leaving')
    const sweep = { kick: vi.fn(), canSettle: () => true, requestsPause: () => null }
    const refresh = new RatingsRefresh(libraries(), metadata(), scanner(), sweep)

    refresh.start(id)
    expect(refresh.status(id)).toEqual({
      state: 'running',
      done: 0,
      total: 2,
      startedAt: expect.any(String),
    })
    expect(sweep.kick).toHaveBeenCalledOnce()

    metadata().remove(deleted)
    expect(refresh.status(id)).toMatchObject({ state: 'running', done: 1, total: 2 })

    // As Refresh details' answer from the source that settles it would.
    metadata().clearRequest(refreshed)
    expect(refresh.status(id)).toEqual({ state: 'idle', finishedAt: expect.any(String) })
    expect(libraries().ratingsRefresh(id)).toMatchObject({ startedAt: null, total: 2 })
  })

  it('ends when cancelled: its remaining titles are dropped and its scan is stopped', () => {
    const { id } = library('Cancelled')
    const other = library('Other')
    const sweep = { kick: vi.fn(), canSettle: () => true, requestsPause: () => null }
    const scanning = scanner()
    const refresh = new RatingsRefresh(libraries(), metadata(), scanning, sweep)
    refresh.start(id)
    refresh.start(other.id)

    refresh.cancel(id)

    expect(scanning.cancel).toHaveBeenCalledWith(id)
    expect(metadata().requestsLeft(id)).toBe(0)
    expect(refresh.status(id)).toEqual({ state: 'idle', finishedAt: expect.any(String) })
    // Another library's Refresh carries on.
    expect(refresh.status(other.id)).toMatchObject({ state: 'running', total: 2 })
  })

  it('starts anew when pressed after its last title left outside the sweep, unread', () => {
    const { id, itemIds } = library('Again')
    const sweep = { kick: vi.fn(), canSettle: () => true, requestsPause: () => null }
    const refresh = new RatingsRefresh(libraries(), metadata(), scanner(), sweep)

    refresh.start(id)
    itemIds.forEach((itemId) => metadata().clearRequest(itemId))
    refresh.start(id)

    expect(metadata().requestsLeft(id)).toBe(2)
    expect(refresh.status(id)).toMatchObject({ state: 'running', done: 0, total: 2 })
  })
})
