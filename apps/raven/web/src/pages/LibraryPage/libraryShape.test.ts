import { describe, expect, it } from 'bun:test'
import { DEFAULT_LIBRARY_SETTINGS, type LibrarySettings } from '@raven/core'
import { playQueue } from '@/pages/LibraryPage/libraryShape'
import { mediaItem, showEntry } from '@/test/fixtures'

const settings = (change: Partial<LibrarySettings>): LibrarySettings => ({
  ...DEFAULT_LIBRARY_SETTINGS,
  ...change,
})

describe('playQueue', () => {
  const wide = mediaItem({ id: 1, title: 'Wide', width: 3840, height: 2160 })
  const full = mediaItem({ id: 2, title: 'Full', width: 1920, height: 1080 })

  it('has nothing to play in an empty listing', () => {
    const queue = playQueue({ settings: settings({}), listing: { shows: [], files: [] } })
    expect(queue.playable).toBe(false)
    expect(queue.first()).toBeUndefined()
    expect(queue.random()).toBeUndefined()
  })

  it("starts a show's next episode before any file", () => {
    const next = mediaItem({ id: 9 })
    const queue = playQueue({
      settings: settings({ kind: 'shows' }),
      listing: { shows: [showEntry({ next })], files: [full] },
    })
    expect(queue.playable).toBe(true)
    expect(queue.first()).toBe(next)
  })

  it('starts the top of the first bucket in the grouped view', () => {
    const queue = playQueue({
      settings: settings({ kind: 'other', view: 'grouped', groupBy: 'resolution' }),
      listing: { shows: [], files: [full, wide] },
    })
    expect(queue.first()).toBe(wide)
  })
})
