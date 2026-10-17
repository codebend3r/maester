import { describe, expect, it } from 'bun:test'
import {
  LIBRARY_SECTIONS,
  type LibrarySection,
  SECTIONS,
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

  it('reads All from no param, a tab from its name, and nothing from anything else', () => {
    expect(sectionFrom(undefined)).toBe('all')
    expect(sectionFrom('sagas')).toBe('sagas')
    expect(sectionFrom('duplicates')).toBe('duplicates')
    expect(sectionFrom('all')).toBeNull()
    expect(sectionFrom('history')).toBeNull()
  })

  it("puts All at the library's own address and every other tab beneath it", () => {
    expect(sectionPath({ libraryId: 4, section: 'all' })).toBe('/libraries/4')
    expect(sectionPath({ libraryId: 4, section: 'not-matched' })).toBe('/libraries/4/not-matched')
  })

  it("counts All and Not matched from the library's own counts, and no other tab", () => {
    const counts = { itemCount: 1204, unmatchedCount: 3 }
    const countOf = (section: LibrarySection) => SECTIONS[section].count(counts)
    expect(Object.values(LIBRARY_SECTIONS).map(countOf)).toEqual([
      1204,
      null,
      null,
      null,
      3,
      null,
      null,
    ])
    expect(SECTIONS['not-matched'].count({ itemCount: 1204, unmatchedCount: 0 })).toBeNull()
    expect(SECTIONS.all.count({ itemCount: 0, unmatchedCount: 0 })).toBe(0)
  })
})
