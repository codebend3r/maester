import { describe, expect, it } from 'bun:test'
import { HOME_SHELF_TYPES, type HomeShelf } from '@/contract'
import { withLibraries } from '@/homeShelves'
import { library } from '@/test/fixtures'

const shelfFor = (libraryId: number): HomeShelf => ({
  libraryId,
  type: HOME_SHELF_TYPES.media,
  media: [],
})

describe('withLibraries', () => {
  it("pairs each shelf with its library, in the shelves' own order", () => {
    const films = library({ id: 1, name: 'Films' })
    const series = library({ id: 2, name: 'Series' })
    const shelves = [shelfFor(2), shelfFor(1)]
    expect(withLibraries({ shelves, libraries: [films, series] })).toEqual([
      { shelf: shelves[0], library: series },
      { shelf: shelves[1], library: films },
    ])
  })

  it('leaves out a shelf for a library the list does not hold, as a locked one', () => {
    const films = library({ id: 1, name: 'Films' })
    const shelves = [shelfFor(9), shelfFor(1)]
    expect(withLibraries({ shelves, libraries: [films] })).toEqual([
      { shelf: shelves[1], library: films },
    ])
    expect(withLibraries({ shelves, libraries: [] })).toEqual([])
  })
})
