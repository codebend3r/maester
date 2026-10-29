import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { LibrariesRepository } from '@/libraries/librariesRepository'
import { MediaIndex } from '@/media/mediaIndex'
import { BLANK_ITEM } from '@/metadata/tmdbShapes'
import { testDatabase } from '@/test/database'
import { repositories } from '@/test/repositories'

describe("a library's backdrop", () => {
  const database = testDatabase('raven-library-backdrop-')
  const state = { libraryId: 0 }
  const metadata = () => repositories(database.get()).metadata
  const media = () => repositories(database.get()).media
  const backdrop = () => media().backdropOf(state.libraryId)

  const addFile = (name: string): number =>
    new MediaIndex(database.get()).insert({
      libraryId: state.libraryId,
      kind: 'movies',
      file: { path: `/m/${name}`, root: '/m', size: 1, mtimeMs: 41 },
    })

  beforeAll(async () => {
    await database.open()
    state.libraryId = new LibrariesRepository(database.get()).create({
      name: 'Movies',
      paths: ['/m'],
      settings: { kind: 'movies' },
    }).id
  })

  afterAll(database.close)

  it('is none for a library with no videos, or whose newest has no picture yet', () => {
    expect(backdrop()).toBeNull()
    addFile('Unknown.mkv')
    expect(backdrop()).toBeNull()
  })

  it("is the newest video's thumbnail once it is made, when it matched nothing", () => {
    const id = addFile('Clip.mkv')
    new MediaIndex(database.get()).setThumbnail({ id, state: 'ready' })
    expect(backdrop()).toEqual({ type: 'thumbnail', id, version: 41 })
  })

  it("is the backdrop of the newest video's movie, whichever of its files is newest", () => {
    const stored = metadata()
    const movieId = stored.save({
      item: {
        ...BLANK_ITEM,
        type: 'movie',
        tmdbId: '949',
        number: null,
        title: 'Heat',
        images: { ...BLANK_ITEM.images, backdrop: '/heat.jpg' },
      },
    })
    const files = [addFile('Heat 2160p.mkv'), addFile('Heat 1080p.mkv')]
    stored.link({ mediaIds: files, itemIds: [movieId] })
    expect(backdrop()).toEqual({
      type: 'item',
      id: movieId,
      version: stored.summaries({ ids: [movieId], libraryId: null }).get(movieId)?.backdropVersion,
    })
  })
})
