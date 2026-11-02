import { describe, expect, it } from 'bun:test'
import { libraryCounts } from '@/test/fixtures'
import {
  FINISHED_LIMIT,
  LIBRARY_SECTIONS,
  type LibrarySection,
  SECTIONS,
  countText,
  sectionFrom,
  sectionPath,
  sectionsFor,
} from '@/pages/LibraryPage/librarySections'

describe('the tabs of a library', () => {
  it('gives Sagas and Duplicates to a library matched to movies, and Not matched to any matched one', () => {
    const everything: LibrarySection[] = [
      'all',
      'in-progress',
      'favourites',
      'sagas',
      'not-matched',
      'duplicates',
      'finished',
    ]
    expect(sectionsFor('movies')).toEqual(everything)
    expect(sectionsFor('familyMovies')).toEqual(everything)
    expect(sectionsFor('documentaries')).toEqual(everything)
    expect(sectionsFor('sports')).toEqual(everything)
    expect(sectionsFor('shows')).toEqual([
      'all',
      'in-progress',
      'favourites',
      'not-matched',
      'finished',
    ])
    expect(sectionsFor('youtube')).toEqual(['all', 'in-progress', 'favourites', 'finished'])
  })

  it("reads the library's opening tab from no param, a tab from its name, and nothing from anything else", () => {
    expect(sectionFrom({ param: undefined, kind: 'movies' })).toBe('all')
    expect(sectionFrom({ param: undefined, kind: 'music' })).toBe('albums')
    expect(sectionFrom({ param: 'sagas', kind: 'movies' })).toBe('sagas')
    expect(sectionFrom({ param: 'duplicates', kind: 'movies' })).toBe('duplicates')
    expect(sectionFrom({ param: 'artists', kind: 'music' })).toBe('artists')
    expect(sectionFrom({ param: 'playlists', kind: 'music' })).toBe('playlists')
    expect(sectionFrom({ param: 'unmatched-albums', kind: 'music' })).toBe('unmatched-albums')
    expect(sectionFrom({ param: 'not-matched', kind: 'music' })).toBe('not-matched')
    expect(sectionFrom({ param: 'all', kind: 'movies' })).toBeNull()
    expect(sectionFrom({ param: 'albums', kind: 'music' })).toBeNull()
    expect(sectionFrom({ param: 'history', kind: 'movies' })).toBeNull()
  })

  it("puts the opening tab at the library's own address and every other tab beneath it", () => {
    expect(sectionPath({ libraryId: 4, section: 'all' })).toBe('/libraries/4')
    expect(sectionPath({ libraryId: 4, section: 'albums' })).toBe('/libraries/4')
    expect(sectionPath({ libraryId: 4, section: 'not-matched' })).toBe('/libraries/4/not-matched')
  })

  it('gives a music library its album, artist, playlist and unmatched-album tabs', () => {
    expect(sectionsFor('music')).toEqual([
      'albums',
      'artists',
      'playlists',
      'unmatched-albums',
      'in-progress',
      'favourites',
      'finished',
    ])
  })

  it("counts All and Not matched from the library, and the rest from the account's counts once they come", () => {
    const library = { itemCount: 1204, unmatchedCount: 0 }
    const counts = { inProgress: 2, favourites: 5, sagas: 3, duplicates: 4, finished: 31 }
    const countOf = (section: LibrarySection) =>
      countText({ section, tallies: { ...library, ...counts } })
    expect(Object.values(LIBRARY_SECTIONS).map(countOf)).toEqual([
      '1,204',
      null,
      null,
      null,
      null,
      '2',
      '5',
      '3',
      '0',
      '4',
      '31',
    ])
    const waiting = (section: LibrarySection) => countText({ section, tallies: library })
    expect(Object.values(LIBRARY_SECTIONS).map(waiting)).toEqual([
      '1,204',
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      '0',
      null,
      null,
    ])
  })

  it('counts Recently finished up to the most it lists, and that many and more past it', () => {
    const finished = (n: number) =>
      countText({ section: 'finished', tallies: libraryCounts({ finished: n }) })
    expect(finished(FINISHED_LIMIT)).toBe('48')
    expect(finished(1500)).toBe('48+')
  })

  it('gives each library distinct tab icons', () => {
    const icons = (kind: 'movies' | 'shows' | 'music') =>
      sectionsFor(kind).map((section) => SECTIONS[section].icon)
    const kinds = ['movies', 'shows', 'music'] as const
    kinds.forEach((kind) => {
      const ownIcons = icons(kind)
      expect(new Set(ownIcons).size).toBe(ownIcons.length)
    })
  })
})
