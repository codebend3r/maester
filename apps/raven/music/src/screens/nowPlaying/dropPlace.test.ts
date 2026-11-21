import { describe, expect, it } from 'bun:test'

import { dropPlaceOf } from '@/screens/nowPlaying/dropPlace'

describe('dropPlaceOf', () => {
  it('moves a row by the whole rows it passed, inside the songs still to play', () => {
    const at = { place: 3, rowHeight: 60, first: 2, last: 6 }
    expect(dropPlaceOf({ ...at, shift: 20 })).toBe(3)
    expect(dropPlaceOf({ ...at, shift: 130 })).toBe(5)
    expect(dropPlaceOf({ ...at, shift: -70 })).toBe(2)
    expect(dropPlaceOf({ ...at, shift: -600 })).toBe(2)
    expect(dropPlaceOf({ ...at, shift: 600 })).toBe(6)
  })
})
