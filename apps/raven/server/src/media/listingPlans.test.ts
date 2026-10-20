import { MEDIA_SORTS } from '@raven/core'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { DatabaseService } from '@/db/database'
import { LibrariesRepository } from '@/libraries/librariesRepository'
import { MediaIndex } from '@/media/mediaIndex'
import { MovieSplits } from '@/media/movieSplits'
import { ViewingRepository } from '@/media/viewingRepository'
import { BLANK_ITEM, type FetchedSaga } from '@/metadata/tmdbClient'
import { testDatabase } from '@/test/database'
import { planLikeProduction, tracedDatabase } from '@/test/queryPlans'
import { TEST_ACCOUNTS, repositories } from '@/test/repositories'

const STONE: FetchedSaga = { tmdbId: '1001', name: 'The Stone Collection' }

type Read = (from: {
  database: DatabaseService
  libraryId: number
  itemIds: readonly number[]
}) => unknown

const account = TEST_ACCOUNTS.b

/** The reads of a library that join each file to its first item. */
const READS = {
  'its newest cards': ({ database, libraryId }) =>
    repositories(database).media.list({
      libraryId,
      sort: MEDIA_SORTS.added,
      limit: 8,
      account,
    }),
  'its sagas': ({ database, libraryId }) =>
    repositories(database).media.listSagas({ libraryId, account }),
  'its duplicates': ({ database, libraryId }) =>
    new MovieSplits(database, repositories(database).media).list({ libraryId, account }),
} as const satisfies Record<string, Read>

/** The reads of what one account watched, kept and favoured. */
const VIEWING_READS = {
  'its cards': ({ database, libraryId }) =>
    repositories(database).media.list({ libraryId, account }),
  'its shows': ({ database, libraryId }) =>
    repositories(database).media.listShows({ libraryId, account }),
  'its videos in progress': ({ database, libraryId }) =>
    repositories(database).media.listInProgress({ libraryId, account }),
  'its history': ({ database, libraryId }) =>
    new ViewingRepository(database, repositories(database).media).history({
      libraryId,
      limit: 10,
      account,
    }),
  'its watched episodes': ({ database, itemIds }) =>
    repositories(database).media.watchedEpisodes({ ids: itemIds, account }),
} as const satisfies Record<string, Read>

/** A step over a spot, a favourite or a play, by its alias in the listings or its table. */
const VIEWING_STEP = /^[A-Z-]+ (p|f|pl|plays|playback_progress|favourites)\b/

/** A step over the viewing tables named as themselves, as a delete's cascade reads them. */
const VIEWING_TABLE_STEP = /^[A-Z-]+ (playback_progress|favourites|item_favourites|plays)\b/

/** A cascade's step that finds the rows of one video or title by the index kept for it. */
const CASCADE_BY_INDEX =
  /^SEARCH \w+ USING (COVERING )?INDEX (playback_progress_media|favourites_media|item_favourites_item|plays_media) \((media|item)_id=\?\)$/

/**
 * A spot or favourite found by its primary key, account first, or by its
 * video's index with the account too, which a WITHOUT ROWID table's index
 * carries; or a play by `plays_account`. SQLite says EXISTS where it runs
 * an `EXISTS` as a join.
 */
const BY_ACCOUNT =
  /^SEARCH ((p|f) USING PRIMARY KEY \(account_id=\?|(p|f) USING INDEX (playback_progress|favourites)_media \(media_id=\? AND account_id=\?\)|pl( EXISTS)? USING (COVERING )?INDEX plays_account \(account_id=\?)/

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
  const state = { libraryId: 0, itemIds: new Array<number>() }

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
    state.itemIds = [...state.itemIds, itemId]
  }

  /** Every step SQLite took for `read`. */
  const stepsOf = (read: Read) => {
    const traced = tracedDatabase(database.get())
    try {
      read({ database: traced.database, libraryId: state.libraryId, itemIds: state.itemIds })
      return traced.steps()
    } finally {
      traced.database.onModuleDestroy()
    }
  }

  beforeEach(async () => {
    await database.open()
    state.itemIds = []
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

  it('looks a card’s plays up by their account and file, never reading every play', () => {
    const details = stepsOf(READS['its newest cards']).map((step) => step.detail)

    expect(details).toContainEqual(
      expect.stringMatching(
        /^SEARCH pl USING (COVERING )?INDEX plays_account \(account_id=\? AND media_id=\?/,
      ),
    )
    expect(details.filter((detail) => /^(SCAN|MATERIALIZE) (pl|plays)\b/.test(detail))).toEqual([])
  })

  it('clears a deleted video’s or title’s spots, favourites and plays by index, never reading them all', () => {
    const { db } = database.get()
    const planOf = (sql: string) =>
      db
        .prepare<[number], { detail: string }>(`EXPLAIN QUERY PLAN ${sql}`)
        .all(1)
        .map((row) => row.detail)
    const cascades = [
      ...planOf('DELETE FROM media WHERE id = ?'),
      ...planOf('DELETE FROM items WHERE id = ?'),
    ].filter((detail) => VIEWING_TABLE_STEP.test(detail))

    expect(cascades).toHaveLength(4)
    expect(cascades.filter((detail) => !CASCADE_BY_INDEX.test(detail))).toEqual([])
  })

  it.each(Object.entries(VIEWING_READS))(
    'reads %s by the account’s key, never every spot, favourite or play',
    (_name, read) => {
      const viewing = stepsOf(read)
        .map((step) => step.detail)
        .filter((detail) => VIEWING_STEP.test(detail))

      expect(viewing).not.toEqual([])
      expect(viewing.filter((detail) => !BY_ACCOUNT.test(detail))).toEqual([])
    },
  )

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
