import { describe, expect, it } from 'bun:test'
import { ALBUM_TYPES, type AlbumSummary, MATCH_STATES } from '@raven/core'

import { HOME_COPY } from '@/copy/screens'
import { recentDateLineOf } from '@/library/recentDates'
import { RECENT_SORTS } from '@/prefs'

type AlbumDatedProps = { releaseDate: string | null; year: number | null; addedAt: string }

const albumDated = ({ releaseDate, year, addedAt }: AlbumDatedProps): AlbumSummary => ({
  id: 1,
  libraryId: 5,
  title: 'Kid A',
  sortTitle: 'Kid A',
  year,
  releaseDate,
  type: ALBUM_TYPES.album,
  artists: [{ id: 1, name: 'Radiohead' }],
  isCompilation: false,
  trackCount: 10,
  duration: 2400,
  coverVersion: null,
  match: MATCH_STATES.matched,
  addedAt,
})

const released = (album: AlbumSummary) => recentDateLineOf({ album, sort: RECENT_SORTS.release })

describe('recentDateLineOf', () => {
  it('names the release day under Latest released, on its calendar day', () => {
    const album = albumDated({
      releaseDate: '2000-10-02',
      year: 2000,
      addedAt: '2026-01-02T12:00:00Z',
    })

    expect(released(album)).toBe(HOME_COPY.dates.released('October 2, 2000'))
  })

  it('names a release only as precisely as it is known', () => {
    const month = albumDated({
      releaseDate: '2000-10',
      year: 2000,
      addedAt: '2026-01-02T12:00:00Z',
    })
    const year = albumDated({ releaseDate: '2000', year: 2000, addedAt: '2026-01-02T12:00:00Z' })
    const tagged = albumDated({ releaseDate: null, year: 2000, addedAt: '2026-01-02T12:00:00Z' })

    expect(released(month)).toBe(HOME_COPY.dates.released('October 2000'))
    expect(released(year)).toBe(HOME_COPY.dates.released('2000'))
    expect(released(tagged)).toBe(HOME_COPY.dates.released('2000'))
  })

  it('says an undated release is unknown', () => {
    const album = albumDated({ releaseDate: null, year: null, addedAt: '2026-01-02T12:00:00Z' })

    expect(released(album)).toBe(HOME_COPY.dates.releaseUnknown)
  })

  it('names the day an album was added under Date added', () => {
    const album = albumDated({
      releaseDate: '2000-10-02',
      year: 2000,
      addedAt: '2026-01-02T12:00:00Z',
    })
    const unreadable = albumDated({ releaseDate: null, year: null, addedAt: 'soon' })

    expect(recentDateLineOf({ album, sort: RECENT_SORTS.added })).toBe(
      HOME_COPY.dates.added('January 2, 2026'),
    )
    expect(recentDateLineOf({ album: unreadable, sort: RECENT_SORTS.added })).toBe(
      HOME_COPY.dates.addedUnknown,
    )
  })
})
