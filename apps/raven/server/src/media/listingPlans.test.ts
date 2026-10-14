import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { LibrariesRepository } from '@/libraries/librariesRepository'
import { MediaIndex } from '@/media/mediaIndex'
import { BLANK_ITEM } from '@/metadata/tmdbClient'
import { testDatabase } from '@/test/database'
import { tracedDatabase } from '@/test/queryPlans'
import { repositories } from '@/test/repositories'

/**
 * How SQLite runs a library's listing, checked on the statements the
 * repositories send. The faults these catch cost nothing in a small test
 * library and seconds in a real one, so they are caught by their plan.
 */
describe('how a library listing is read', () => {
  const database = testDatabase('raven-plans-')
  const state = { libraryId: 0 }

  /** A movie with a file for each name, as matching leaves it. */
  const addMovie = ({ title, files }: { title: string; files: readonly string[] }): void => {
    const { metadata } = repositories(database.get())
    const itemId = metadata.save({
      item: { ...BLANK_ITEM, type: 'movie', tmdbId: title, number: null, title },
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

  /** Every step SQLite took to list the library's newest cards, as the home page asks. */
  const listingSteps = () => {
    const traced = tracedDatabase(database.get())
    try {
      repositories(traced.database).media.list({
        libraryId: state.libraryId,
        sort: 'added',
        limit: 8,
      })
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
  })

  afterEach(() => database.close())

  it('looks up the items on its cards by id, never copying every item first', () => {
    const details = listingSteps().map((step) => step.detail)

    expect(details).toContain('SEARCH i USING INTEGER PRIMARY KEY (rowid=?) LEFT-JOIN')
    expect(details.filter((detail) => detail.startsWith('MATERIALIZE shown_items'))).toEqual([])
  })

  it('counts each card’s versions from its movie’s files, never walking the whole library', () => {
    const perCard = listingSteps()
      .filter((step) => step.within.some((outer) => outer.startsWith('CORRELATED')))
      .map((step) => step.detail)

    expect(perCard).toContain('SEARCH x USING INDEX media_items_item (item_id=?)')
    expect(
      perCard.filter((detail) => detail.startsWith('SCAN') || detail.includes('(library_id=?)')),
    ).toEqual([])
  })
})
