import { describe, expect, it } from 'bun:test'

import {
  FAN_PLACES,
  TITLE_SIZES,
  fanOffsetOf,
  fanPlaceOf,
  isInFan,
  isInWash,
  stepTurn,
  titleSizeOf,
} from '@/layouts/heroKit'

describe('the fan', () => {
  it('puts the one up in front, the next to the right and the last to the left', () => {
    const places = [0, 1, 2, 3, 4].map((index) =>
      fanPlaceOf({ offset: fanOffsetOf({ index, at: 1, count: 5 }), count: 5 }),
    )
    expect(places).toEqual([
      FAN_PLACES.previous,
      FAN_PLACES.front,
      FAN_PLACES.next,
      FAN_PLACES.away,
      FAN_PLACES.away,
    ])
  })

  it('draws the ones in view and the one the next turn brings in', () => {
    expect([0, 1, 2, 3, 4].map((offset) => isInFan({ offset, count: 5 }))).toEqual([
      true,
      true,
      true,
      false,
      true,
    ])
  })
})

describe('stepTurn', () => {
  it('goes round the ends either way and remembers where it came from', () => {
    expect(stepTurn({ turn: { at: 4, from: null }, by: 1, count: 5 })).toEqual({ at: 0, from: 4 })
    expect(stepTurn({ turn: { at: 0, from: null }, by: -1, count: 5 })).toEqual({ at: 4, from: 0 })
  })
})

describe('isInWash', () => {
  it('draws the backdrop up, the one fading out and the next', () => {
    const turn = { at: 2, from: 1 }
    expect([0, 1, 2, 3, 4].map((index) => isInWash({ index, turn, count: 5 }))).toEqual([
      false,
      true,
      true,
      true,
      false,
    ])
  })
})

describe('titleSizeOf', () => {
  it('sets a long title or a long word a size down, and a longer title down again', () => {
    expect(titleSizeOf('Dune')).toBe(TITLE_SIZES.display)
    expect(titleSizeOf('Interstellar')).toBe(TITLE_SIZES.long)
    expect(titleSizeOf('The Lord of the Rings: The Return of the King')).toBe(TITLE_SIZES.longest)
  })
})
