import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { LibrariesRepository } from '@/libraries/librariesRepository'
import { MediaIndex } from '@/media/mediaIndex'
import { localEpisode, localSeason } from '@/metadata/localItems'
import type { MetadataRepository } from '@/metadata/metadataRepository'
import { BLANK_ITEM } from '@/metadata/tmdbClient'
import { testDatabase } from '@/test/database'
import { type PlanStep, planLikeProduction, tracedDatabase } from '@/test/queryPlans'
import { repositories } from '@/test/repositories'

type Read = (from: {
  metadata: MetadataRepository
  ids: { show: number; movie: number }
}) => Map<number, number[]>

/** The reads that find which libraries hold a file of an item. */
const READS = {
  'one item': ({ metadata, ids }) => new Map([[ids.show, metadata.librariesHolding(ids.show)]]),
  'several items': ({ metadata, ids }) => metadata.librariesHoldingEach([ids.show, ids.movie]),
} as const satisfies Record<string, Read>

/** A step that reads every file, `m`, or every file's items, `mi`, rather than an item's own. */
const readsEveryFile = (step: PlanStep): boolean => /^SCAN (m|mi)\b/.test(step.detail)

/**
 * How SQLite finds the libraries holding an item, which the PIN lock asks
 * of every movie and show a page names while a library is locked. Reading
 * every file to answer it cost a tenth of a second a title on a real
 * library, so the read is checked by its plan, as SQLite plans it in a
 * fresh database and with a real library's statistics.
 */
describe.each([
  { statistics: 'no statistics', prepare: (): void => undefined },
  { statistics: "a real library's statistics", prepare: planLikeProduction },
])('how the libraries holding an item are found, with $statistics', ({ prepare }) => {
  const database = testDatabase('raven-holding-plans-')
  const state = { libraryId: 0, show: 0, movie: 0 }

  /** Every step SQLite took for `read`, and what it answered. */
  const run = (read: Read) => {
    const traced = tracedDatabase(database.get())
    try {
      const holding = read({
        metadata: repositories(traced.database).metadata,
        ids: { show: state.show, movie: state.movie },
      })
      return { holding, steps: traced.steps() }
    } finally {
      traced.database.onModuleDestroy()
    }
  }

  beforeEach(async () => {
    await database.open()
    state.libraryId = new LibrariesRepository(database.get()).create({
      name: 'Shows',
      paths: ['/tv'],
      settings: { kind: 'shows' },
    }).id
    const { metadata } = repositories(database.get())
    const index = new MediaIndex(database.get())
    const file = (name: string): number =>
      index.insert({
        libraryId: state.libraryId,
        kind: 'shows',
        file: { path: `/tv/${name}`, root: '/tv', size: 1, mtimeMs: 1 },
      })
    state.show = metadata.save({
      item: { ...BLANK_ITEM, type: 'show', tmdbId: '500', number: null, title: 'Slow Horses' },
    })
    const season = metadata.saveSeason({
      showId: state.show,
      number: 1,
      season: localSeason({ showTmdbId: '500', number: 1 }),
      episodes: [localEpisode({ showTmdbId: '500', season: 1, number: 1, title: null })],
    })
    metadata.link({
      mediaIds: [file('Slow Horses S01E01.mkv')],
      itemIds: [...season.episodes.values()],
    })
    state.movie = metadata.save({
      item: { ...BLANK_ITEM, type: 'movie', tmdbId: '600', number: null, title: 'Heat' },
    })
    metadata.link({ mediaIds: [file('Heat.mkv')], itemIds: [state.movie] })
    prepare(database.get())
  })

  afterEach(database.close)

  it.each(Object.entries(READS))('walks down from the item for %s', (_name, read) => {
    const { holding, steps } = run(read)
    expect(holding.get(state.show)).toEqual([state.libraryId])
    expect(steps.length).toBeGreaterThan(0)
    expect(steps.filter(readsEveryFile)).toEqual([])
  })
})
