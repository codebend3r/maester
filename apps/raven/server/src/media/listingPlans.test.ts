import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { DatabaseService } from '@/db/database'
import { LibrariesRepository } from '@/libraries/librariesRepository'
import { MediaIndex } from '@/media/mediaIndex'
import { MovieSplits } from '@/media/movieSplits'
import { BLANK_ITEM, type FetchedSaga } from '@/metadata/tmdbClient'
import { testDatabase } from '@/test/database'
import { planLikeProduction, tracedDatabase } from '@/test/queryPlans'
import { repositories } from '@/test/repositories'

const STONE: FetchedSaga = { tmdbId: '1001', name: 'The Stone Collection' }

type Read = (from: { database: DatabaseService; libraryId: number }) => unknown

/** The reads of a library that join each file to its first item. */
const READS = {
  'its newest cards': ({ database, libraryId }) =>
    repositories(database).media.list({ libraryId, sort: 'added', limit: 8 }),
  'its sagas': ({ database, libraryId }) => repositories(database).media.listSagas(libraryId),
  'its duplicates': ({ database, libraryId }) =>
    new MovieSplits(database, repositories(database).media).list(libraryId),
} as const satisfies Record<string, Read>

/** How `FIRST_ITEM` finds a file's first item, `z`: by the file's own key. */
const FIRST_ITEM_BY_KEY = /^SEARCH z USING (COVERING )?INDEX \w+ \(media_id=\?\)$/

/**
 * A step that reads every file's items, in place or into a copy, rather than
 * a file's own: `media_items`, or `mi` for the join `FIRST_ITEM` makes, read
 * whole, or its first item `z` read any way but by key. Without an index,
 * SQLite calls a full read of `z` a SEARCH, not a SCAN.
 */
const readsEveryFilesItems = (detail: string): boolean =>
  /^(SCAN|MATERIALIZE|CO-ROUTINE) (media_items|mi)\b/.test(detail) ||
  (/^[A-Z-]+ z\b/.test(detail) && !FIRST_ITEM_BY_KEY.test(detail))

/**
 * How SQLite runs a library's reads, checked on the statements the
 * repositories send. The faults these catch cost nothing in a small test
 * library and seconds in a real one, so they are caught by their plan. The
 * server keeps statistics, which steer the planner, so each read is planned
 * as it is in a fresh database and as it is with a real library's.
 */
describe.each([
  { statistics: 'no statistics', prepare: (): void => undefined },
  { statistics: "a real library's statistics", prepare: planLikeProduction },
])('how a library is read, with $statistics', ({ prepare }) => {
  const database = testDatabase('raven-plans-')
  const state = { libraryId: 0 }

  /** A movie of a saga, with a file for each name, as matching leaves it. */
  const addMovie = ({ title, files }: { title: string; files: readonly string[] }): void => {
    const { metadata } = repositories(database.get())
    const itemId = metadata.save({
      item: { ...BLANK_ITEM, type: 'movie', tmdbId: title, number: null, title, saga: STONE },
    })
    const index = new MediaIndex(database.get())
    const mediaIds = files.map((name) =>
      index.insert({
        libraryId: state.libraryId,
        kind: 'movies',
        file: { path: `/m/${title}/${name}`, root: '/m', size: 1, mtimeMs: 1 },
      }),
    )
    metadata.link({ mediaIds, itemIds: [itemId] })
  }

  /** Every step SQLite took for `read`. */
  const stepsOf = (read: Read) => {
    const traced = tracedDatabase(database.get())
    try {
      read({ database: traced.database, libraryId: state.libraryId })
      return traced.steps()
    } finally {
      traced.database.onModuleDestroy()
    }
  }

  beforeEach(async () => {
    await database.open()
    state.libraryId = new LibrariesRepository(database.get()).create({
      name: 'Movies',
      paths: ['/m'],
      settings: { kind: 'movies' },
    }).id
    addMovie({ title: 'Alexander', files: ['Alexander.mkv', 'Alexander Final Cut.mkv'] })
    addMovie({ title: 'Collateral', files: ['Collateral.mkv'] })
    prepare(database.get())
  })

  afterEach(() => database.close())

  it('looks up the items on its cards by id, never copying every item first', () => {
    const details = stepsOf(READS['its newest cards']).map((step) => step.detail)

    expect(details).toContain('SEARCH i USING INTEGER PRIMARY KEY (rowid=?) LEFT-JOIN')
    expect(details.filter((detail) => detail.startsWith('MATERIALIZE shown_items'))).toEqual([])
  })

  it('counts each card’s versions from its movie’s files, never walking the whole library', () => {
    const perCard = stepsOf(READS['its newest cards'])
      .filter((step) => step.within.some((outer) => outer.startsWith('CORRELATED')))
      .map((step) => step.detail)

    expect(perCard).toContain('SEARCH x USING INDEX media_items_item (item_id=?)')
    expect(
      perCard.filter((detail) => detail.startsWith('SCAN') || detail.includes('(library_id=?)')),
    ).toEqual([])
  })

  it.each(Object.entries(READS))(
    'reads %s from the library’s own files, each with its own first item',
    (_name, read) => {
      const details = stepsOf(read).map((step) => step.detail)

      expect(details).toContainEqual(
        expect.stringMatching(/^SEARCH m USING (COVERING )?INDEX \w+ \(library_id=\?/),
      )
      expect(details).toContainEqual(expect.stringMatching(FIRST_ITEM_BY_KEY))
      expect(details.filter(readsEveryFilesItems)).toEqual([])
    },
  )
})
