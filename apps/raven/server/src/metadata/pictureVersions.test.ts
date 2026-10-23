import { IMAGE_SOURCES, ITEM_IMAGE_KINDS } from '@raven/core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { testDatabase } from '@/test/database'
import { pictureVersionsOf } from '@/test/repositories'

describe('picture versions', () => {
  const database = testDatabase('raven-picture-versions-')

  beforeAll(async () => {
    await database.open()
  })

  afterAll(async () => {
    await database.close()
  })

  const poster = { kind: ITEM_IMAGE_KINDS.poster, source: IMAGE_SOURCES.tmdb, ref: '/matrix.jpg' }

  it('stays the same for the same picture, across restarts', () => {
    const first = pictureVersionsOf(database.get()).item({ id: 1, ...poster })
    expect(pictureVersionsOf(database.get()).item({ id: 1, ...poster })).toBe(first)
  })

  it("never opens another item's or kind's picture that shows the same file", () => {
    const versions = pictureVersionsOf(database.get())
    const own = versions.item({ id: 1, ...poster })
    expect(versions.item({ id: 2, ...poster })).not.toBe(own)
    expect(versions.item({ id: 1, ...poster, kind: ITEM_IMAGE_KINDS.backdrop })).not.toBe(own)
    expect(versions.photo({ id: 2, photo: '/keanu.jpg' })).not.toBe(
      versions.photo({ id: 3, photo: '/keanu.jpg' }),
    )
  })

  it('is none for a person with no photo', () => {
    expect(pictureVersionsOf(database.get()).photo({ id: 1, photo: null })).toBeNull()
  })
})
