import { ITEM_IMAGE_KINDS } from '@raven/core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { LibrariesRepository } from '@/libraries/librariesRepository'
import { MediaIndex } from '@/media/mediaIndex'
import { STORED_IMAGE_SOURCES } from '@/metadata/itemImagesRepository'
import { BLANK_ITEM } from '@/metadata/tmdbShapes'
import { testDatabase } from '@/test/database'
import { TEST_ACCOUNTS, repositories } from '@/test/repositories'

/** One movie, a file of it in each of two libraries, as a 4K and a 1080p library hold the same title. */
describe("a title's pictures in each library holding it", () => {
  const database = testDatabase('raven-library-pictures-')
  const state = { uhd: 0, hd: 0, itemId: 0 }
  const stores = () => repositories(database.get())
  const posterIn = (libraryId: number): string | null =>
    stores()
      .media.list({ libraryId, account: TEST_ACCOUNTS.a })
      .find((media) => media.item?.id === state.itemId)?.item?.posterVersion ?? null
  const ownPoster = (): string | null =>
    stores()
      .images.versions({ ids: [state.itemId], kind: ITEM_IMAGE_KINDS.poster, libraryId: null })
      .get(state.itemId) ?? null

  beforeAll(async () => {
    await database.open()
    const libraries = new LibrariesRepository(database.get())
    state.uhd = libraries.create({ name: '4K Movies', paths: ['/uhd'] }).id
    state.hd = libraries.create({ name: 'Movies', paths: ['/hd'] }).id
    const { metadata } = stores()
    state.itemId = metadata.save({
      item: {
        ...BLANK_ITEM,
        type: 'movie',
        tmdbId: '1',
        number: null,
        title: 'Disclosure Day',
        images: { ...BLANK_ITEM.images, poster: '/own.jpg', backdrop: '/own-backdrop.jpg' },
      },
    })
    const index = new MediaIndex(database.get())
    const files = [
      { libraryId: state.uhd, root: '/uhd' },
      { libraryId: state.hd, root: '/hd' },
    ].map(({ libraryId, root }) =>
      index.insert({
        libraryId,
        kind: 'movies',
        file: { path: `${root}/Disclosure Day.mkv`, root, size: 1, mtimeMs: 1 },
      }),
    )
    metadata.link({ mediaIds: files, itemIds: [state.itemId] })
  })

  afterAll(database.close)

  it('starts with the same poster in both', () => {
    expect(posterIn(state.uhd)).toEqual(expect.any(String))
    expect(posterIn(state.uhd)).toBe(posterIn(state.hd))
  })

  it('changes the poster of the library it was chosen in alone', () => {
    const before = posterIn(state.hd)
    stores().images.chooseImage({
      itemId: state.itemId,
      kind: ITEM_IMAGE_KINDS.poster,
      libraryId: state.uhd,
      ref: '/uhd.jpg',
    })
    expect(posterIn(state.uhd)).not.toBe(before)
    expect(posterIn(state.hd)).toBe(before)
    expect(
      stores().images.image({
        itemId: state.itemId,
        kind: ITEM_IMAGE_KINDS.poster,
        libraryId: state.uhd,
      }),
    ).toEqual({ source: STORED_IMAGE_SOURCES.chosen, ref: '/uhd.jpg' })
    expect(
      stores().images.image({
        itemId: state.itemId,
        kind: ITEM_IMAGE_KINDS.poster,
        libraryId: null,
      }),
    ).toEqual({
      source: STORED_IMAGE_SOURCES.tmdb,
      ref: '/own.jpg',
    })
  })

  it("lets the other library choose its own, and each address finds its library's picture", () => {
    stores().images.chooseImage({
      itemId: state.itemId,
      kind: ITEM_IMAGE_KINDS.poster,
      libraryId: state.hd,
      ref: '/hd.jpg',
    })
    expect(posterIn(state.hd)).not.toBe(posterIn(state.uhd))
    const candidates = stores().images.candidates({
      itemId: state.itemId,
      kind: ITEM_IMAGE_KINDS.poster,
    })
    // The title's own, and each library's choice: an address finds the picture it names.
    expect(candidates.map((candidate) => candidate.version).toSorted()).toEqual(
      [posterIn(state.uhd), posterIn(state.hd), ownPoster()].toSorted(),
    )
    expect(
      candidates.find((candidate) => candidate.version === posterIn(state.hd))?.image ?? null,
    ).toEqual({ source: 'chosen', ref: '/hd.jpg' })
  })

  it("gives the item's page each library's pictures, the backdrop untouched by a poster's choice", () => {
    const pictures = stores().metadata.libraryPictures({
      id: state.itemId,
      libraryIds: [state.uhd, state.hd],
    })
    expect(pictures.map((entry) => entry.posterVersion)).toEqual([
      posterIn(state.uhd),
      posterIn(state.hd),
    ])
    expect(new Set(pictures.map((entry) => entry.backdropVersion)).size).toBe(1)
  })

  it('goes back to the title’s own poster in one library alone', () => {
    const chosenHd = posterIn(state.hd)
    stores().images.chooseImage({
      itemId: state.itemId,
      kind: ITEM_IMAGE_KINDS.poster,
      libraryId: state.uhd,
      ref: null,
    })
    expect(posterIn(state.uhd)).toBe(
      stores()
        .metadata.summaries({ ids: [state.itemId], libraryId: null })
        .get(state.itemId)?.posterVersion ?? null,
    )
    expect(posterIn(state.hd)).toBe(chosenHd)
  })
})
