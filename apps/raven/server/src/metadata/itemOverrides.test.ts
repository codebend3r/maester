import { MEDIA_SORTS } from '@raven/core'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { LibrariesRepository } from '@/libraries/librariesRepository'
import { MediaIndex } from '@/media/mediaIndex'
import { ItemOverrides } from '@/metadata/itemOverrides'
import { BLANK_ITEM, type FetchedItem } from '@/metadata/tmdbShapes'
import { testDatabase } from '@/test/database'
import { TEST_ACCOUNTS, repositories } from '@/test/repositories'

type MovieProps = { tmdbId: string; title: string }

const movie = ({ tmdbId, title }: MovieProps): FetchedItem => ({
  ...BLANK_ITEM,
  type: 'movie',
  tmdbId,
  number: null,
  title,
  year: 2004,
  tagline: 'TMDB tagline',
  summary: 'TMDB summary',
  contentRating: 'R',
})

describe('an edit over TMDB’s words', () => {
  const database = testDatabase('raven-overrides-')
  const state = { libraryId: 0 }
  const overrides = () => new ItemOverrides(database.get())

  /** A movie with one file in the library, as matching leaves it. */
  const addMovie = (title: string): number => {
    const { metadata } = repositories(database.get())
    const itemId = metadata.save({ item: movie({ tmdbId: title, title }) })
    const fileId = new MediaIndex(database.get()).insert({
      libraryId: state.libraryId,
      kind: 'movies',
      file: { path: `/m/${title} (2004)/${title}.mkv`, root: '/m', size: 1, mtimeMs: 1 },
    })
    metadata.link({ mediaIds: [fileId], itemIds: [itemId] })
    return itemId
  }

  const details = (itemId: number) => repositories(database.get()).metadata.details(itemId)
  const listed = () =>
    repositories(database.get())
      .media.list({ libraryId: state.libraryId, sort: MEDIA_SORTS.title, account: TEST_ACCOUNTS.a })
      .map((media) => media.item?.title)

  beforeEach(async () => {
    await database.open()
    state.libraryId = new LibrariesRepository(database.get()).create({
      name: 'Movies',
      paths: ['/m'],
      settings: { kind: 'movies' },
    }).id
  })

  afterEach(() => database.close())

  it('shows on the item’s page in place of TMDB’s', () => {
    const itemId = addMovie('Collateral')
    overrides().write({
      itemId,
      change: {
        title: 'Collateral Redux',
        year: 2005,
        tagline: 'Edited tagline',
        summary: 'Edited summary',
        contentRating: 'PG-13',
      },
    })

    expect(details(itemId)).toMatchObject({
      title: 'Collateral Redux',
      originalTitle: null,
      year: 2005,
      tagline: 'Edited tagline',
      summary: 'Edited summary',
      contentRating: 'PG-13',
    })
  })

  it('names and sorts the card in its library', () => {
    addMovie('Alpha')
    const bravo = addMovie('Bravo')
    expect(listed()).toEqual(['Alpha', 'Bravo'])

    overrides().write({ itemId: bravo, change: { title: 'Aardvark' } })

    expect(listed()).toEqual(['Aardvark', 'Alpha'])
  })

  it('gives TMDB’s words back once cleared', () => {
    const itemId = addMovie('Collateral')
    overrides().write({ itemId, change: { title: 'Collateral Redux', tagline: 'Edited' } })

    overrides().write({ itemId, change: { title: null, tagline: null } })

    expect(details(itemId)).toMatchObject({ title: 'Collateral', tagline: 'TMDB tagline' })
  })

  it('shows a field emptied over TMDB’s as nothing', () => {
    const itemId = addMovie('Collateral')

    overrides().write({ itemId, change: { year: 0, tagline: '', summary: '', contentRating: '' } })

    expect(details(itemId)).toMatchObject({
      title: 'Collateral',
      year: null,
      tagline: null,
      summary: null,
      contentRating: null,
    })
  })
})
