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

describe("a library's ratings", () => {
  const database = testDatabase('raven-ratings-refresh-')
  const libraries = () => new LibrariesRepository(database.get())
  const metadata = () => repositories(database.get()).metadata
  const scanner = () => ({
    quickScanNow: vi.fn<ScannerService['quickScanNow']>(),
    whenIdle: vi.fn<ScannerService['whenIdle']>(async () => undefined),
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

  type SweepWithProps = { tmdb: TmdbClient }

  /** The real sweep, with no score source that has a key, and `tmdb` for TMDB's own score. */
  const sweepWith = ({ tmdb }: SweepWithProps): ScoreSweep => {
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
    new RatingsRefresh(libraries(), metadata(), scanner(), sweep).start({ libraryId: id })
    await sweep.whenIdle()
    sweep.onModuleDestroy()

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
    const refresh = new RatingsRefresh(libraries(), metadata(), scanner(), sweep)

    refresh.start({ libraryId: id })
    await sweep.whenIdle()
    sweep.onModuleDestroy()

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

    refresh.start({ libraryId: id })
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

  it('asks only for the titles that have no rating, and leaves a rated one out', () => {
    const {
      id,
      itemIds: [rated = -1],
    } = library('Rated')
    metadata().saveScores({
      itemId: rated,
      provider: 'mdblist',
      scores: [{ source: 'imdb', value: 7.5, votes: 100 }],
    })
    const sweep = { kick: vi.fn(), canSettle: () => true, requestsPause: () => null }
    const refresh = new RatingsRefresh(libraries(), metadata(), scanner(), sweep)

    refresh.start({ libraryId: id })

    expect(metadata().requestsLeft(id)).toBe(1)
    expect(refresh.status(id)).toMatchObject({ state: 'running', done: 0, total: 1 })
    expect(metadata().isRequested(rated)).toBe(false)
  })

  it('adds to an update under way the titles that have no rating since', () => {
    const { id } = library('Adding')
    const sweep = { kick: vi.fn(), canSettle: () => true, requestsPause: () => null }
    const refresh = new RatingsRefresh(libraries(), metadata(), scanner(), sweep)
    refresh.start({ libraryId: id })
    const index = new MediaIndex(database.get())
    const added = metadata().save({
      item: { ...BLANK_ITEM, type: 'movie', tmdbId: 'Adding-3', number: null, title: 'Adding 3' },
    })
    metadata().link({
      mediaIds: [
        index.insert({
          libraryId: id,
          kind: 'movies',
          file: { path: '/Adding/3.mkv', root: '/Adding', size: 1, mtimeMs: 1 },
        }),
      ],
      itemIds: [added],
    })

    refresh.start({ libraryId: id })

    expect(refresh.status(id)).toMatchObject({ state: 'running', done: 0, total: 3 })
  })

  it('ends when cancelled: its remaining titles are dropped, and another library keeps its own', () => {
    const { id } = library('Cancelled')
    const other = library('Other')
    const sweep = { kick: vi.fn(), canSettle: () => true, requestsPause: () => null }
    const refresh = new RatingsRefresh(libraries(), metadata(), scanner(), sweep)
    refresh.start({ libraryId: id })
    refresh.start({ libraryId: other.id })

    refresh.cancel(id)

    expect(metadata().requestsLeft(id)).toBe(0)
    expect(refresh.status(id)).toEqual({ state: 'idle', finishedAt: expect.any(String) })
    expect(refresh.status(other.id)).toMatchObject({ state: 'running', total: 2 })
  })

  describe('after a quick scan', () => {
    /** A scan that ends when `release` is called. */
    const scanEndingLater = () => {
      const scanning = scanner()
      const gate: { release: () => void } = { release: () => undefined }
      scanning.whenIdle.mockImplementation(
        () =>
          new Promise<void>((resolve) => {
            gate.release = resolve
          }),
      )
      return { scanning, gate }
    }
    const settle = () => new Promise((resolve) => setTimeout(resolve, 0))
    type AddTitleProps = { libraryId: number; name: string }

    const addTitle = ({ libraryId, name }: AddTitleProps): void => {
      const index = new MediaIndex(database.get())
      const itemId = metadata().save({
        item: { ...BLANK_ITEM, type: 'movie', tmdbId: name, number: null, title: name },
      })
      metadata().link({
        mediaIds: [
          index.insert({
            libraryId,
            kind: 'movies',
            file: { path: `/${name}.mkv`, root: '/', size: 1, mtimeMs: 1 },
          }),
        ],
        itemIds: [itemId],
      })
    }

    it('asks for the ratings of the titles it added, and of no title that was already there', async () => {
      const { id } = library('Quick')
      const { scanning, gate } = scanEndingLater()
      const sweep = { kick: vi.fn(), canSettle: () => true, requestsPause: () => null }
      const refresh = new RatingsRefresh(libraries(), metadata(), scanning, sweep)

      // The two titles the library holds were matched before this scan began.
      await settle()
      refresh.quickScan(id)
      expect(scanning.quickScanNow).toHaveBeenCalledWith(id)
      addTitle({ libraryId: id, name: 'Quick-new' })
      gate.release()
      await settle()

      expect(metadata().requestsLeft(id)).toBe(1)
      expect(refresh.status(id)).toMatchObject({ state: 'running', total: 1 })
      expect(sweep.kick).toHaveBeenCalled()
    })

    it('asks for nothing when it is cancelled, and stops the scan', async () => {
      const { id } = library('Quick cancelled')
      const { scanning, gate } = scanEndingLater()
      const sweep = { kick: vi.fn(), canSettle: () => true, requestsPause: () => null }
      const refresh = new RatingsRefresh(libraries(), metadata(), scanning, sweep)

      refresh.quickScan(id)
      addTitle({ libraryId: id, name: 'Quick-cancelled-new' })
      refresh.cancelQuickScan(id)
      gate.release()
      await settle()

      expect(scanning.cancel).toHaveBeenCalledWith(id)
      expect(metadata().requestsLeft(id)).toBe(0)
      expect(sweep.kick).not.toHaveBeenCalled()
    })
  })

  it('starts anew when pressed after its last title left outside the sweep, unread', () => {
    const { id, itemIds } = library('Again')
    const sweep = { kick: vi.fn(), canSettle: () => true, requestsPause: () => null }
    const refresh = new RatingsRefresh(libraries(), metadata(), scanner(), sweep)

    refresh.start({ libraryId: id })
    itemIds.forEach((itemId) => metadata().clearRequest(itemId))
    refresh.start({ libraryId: id })

    expect(metadata().requestsLeft(id)).toBe(2)
    expect(refresh.status(id)).toMatchObject({ state: 'running', done: 0, total: 2 })
  })
})
