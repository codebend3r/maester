import { describe, expect, it } from 'bun:test'
import type { LibraryCounts } from '@raven/core'

import { LIBRARY_PAGE_COPY } from '@/copy/screens'
import { libraryValuesOf } from '@/library/libraryCounts'
import { LIBRARY_SEGMENTS } from '@/library/segments'

const READ = { isRead: true }

const COUNTS: LibraryCounts = {
  inProgress: 2,
  favourites: 0,
  sagas: 0,
  duplicates: 0,
  finished: 30,
  albums: 1980,
  artists: 412,
  unmatchedAlbums: 3,
}

type AnsweredProps = { data: LibraryCounts }

const answered = ({ data }: AnsweredProps) => ({ data, isSuccess: true })

const PENDING = { data: undefined, isSuccess: false }

describe('libraryValuesOf', () => {
  it("adds every music library's counts up beside its category", () => {
    const values = libraryValuesOf({
      music: READ,
      counts: [answered({ data: COUNTS }), answered({ data: { ...COUNTS, albums: 20 } })],
      playlists: 4,
      songs: 9000,
    })
    expect(values).toEqual({
      [LIBRARY_SEGMENTS.albums]: '2,000',
      [LIBRARY_SEGMENTS.artists]: '824',
      [LIBRARY_SEGMENTS.playlists]: '4',
      [LIBRARY_SEGMENTS.unmatchedAlbums]: '6',
      [LIBRARY_SEGMENTS.inProgress]: '4',
      [LIBRARY_SEGMENTS.favourites]: undefined,
      [LIBRARY_SEGMENTS.finished]: '48+',
      [LIBRARY_SEGMENTS.songs]: '9,000',
    })
  })

  it('leaves every count out while one is on its way, and never shows a zero', () => {
    const values = libraryValuesOf({
      music: READ,
      counts: [answered({ data: COUNTS }), PENDING],
      playlists: 0,
      songs: null,
    })
    expect(values[LIBRARY_SEGMENTS.albums]).toBeUndefined()
    expect(values[LIBRARY_SEGMENTS.songs]).toBeUndefined()
    expect(values[LIBRARY_SEGMENTS.playlists]).toBe(LIBRARY_PAGE_COPY.noneYet)
  })

  it('leaves a count out that an older server does not send', () => {
    const { albums: _albums, ...older } = COUNTS
    const values = libraryValuesOf({
      music: READ,
      counts: [answered({ data: older })],
      playlists: null,
      songs: 3,
    })
    expect(values[LIBRARY_SEGMENTS.albums]).toBeUndefined()
    expect(values[LIBRARY_SEGMENTS.artists]).toBe('412')
  })

  it('counts nothing until the libraries are read', () => {
    const values = libraryValuesOf({
      music: { isRead: false },
      counts: [],
      playlists: null,
      songs: null,
    })
    expect(Object.values(values).every((value) => value === undefined)).toBe(true)
  })
})
