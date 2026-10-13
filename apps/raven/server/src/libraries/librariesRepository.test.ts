import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { LibrariesRepository } from '@/libraries/librariesRepository'
import { testDatabase } from '@/test/database'

describe('libraries', () => {
  const database = testDatabase('raven-libraries-')
  beforeAll(database.open)
  afterAll(database.close)

  it("keeps a library's folder layout, and starts its paths unread", () => {
    const libraries = new LibrariesRepository(database.get())
    const created = libraries.create({
      name: 'Anime',
      paths: ['/media/Anime', '/media/Classics'],
      settings: { kind: 'animeShows', folderLayout: 'flat' },
    })
    expect(created.settings.folderLayout).toBe('flat')
    expect(created.layouts).toEqual([
      { path: '/media/Anime', layout: null, groups: 0 },
      { path: '/media/Classics', layout: null, groups: 0 },
    ])
  })

  it('keeps what a full scan found each path to be, until the paths change', () => {
    const libraries = new LibrariesRepository(database.get())
    const { id } = libraries.create({
      name: 'TV',
      paths: ['/media/TV'],
      settings: { kind: 'shows' },
    })
    expect(libraries.get(id)?.settings.folderLayout).toBe('auto')
    libraries.saveLayouts({ id, layouts: [{ path: '/media/TV', layout: 'lettered', groups: 27 }] })
    expect(libraries.get(id)?.layouts).toEqual([
      { path: '/media/TV', layout: 'lettered', groups: 27 },
    ])
    libraries.update({ id, input: { name: 'TV', paths: ['/media/Shows'] } })
    expect(libraries.get(id)?.layouts).toEqual([{ path: '/media/Shows', layout: null, groups: 0 }])
  })

  it('keeps what each path was found to be through a save that keeps it, and starts a new one unread', () => {
    const libraries = new LibrariesRepository(database.get())
    const { id } = libraries.create({
      name: 'Films',
      paths: ['/media/Films', '/media/Classics'],
      settings: { kind: 'movies' },
    })
    libraries.saveLayouts({
      id,
      layouts: [
        { path: '/media/Films', layout: 'lettered', groups: 26 },
        { path: '/media/Classics', layout: 'flat', groups: 0 },
      ],
    })
    libraries.update({
      id,
      input: {
        name: 'Films',
        paths: ['/media/Films', '/media/Classics'],
        settings: { pinned: true },
      },
    })
    expect(libraries.get(id)?.layouts).toEqual([
      { path: '/media/Films', layout: 'lettered', groups: 26 },
      { path: '/media/Classics', layout: 'flat', groups: 0 },
    ])
    libraries.update({
      id,
      input: { name: 'Films', paths: ['/media/Classics', '/media/Films', '/media/New'] },
    })
    expect(libraries.get(id)?.layouts).toEqual([
      { path: '/media/Classics', layout: 'flat', groups: 0 },
      { path: '/media/Films', layout: 'lettered', groups: 26 },
      { path: '/media/New', layout: null, groups: 0 },
    ])
  })
})
