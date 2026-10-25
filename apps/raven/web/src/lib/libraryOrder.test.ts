import { describe, expect, it } from 'bun:test'
import { moveId, sameOrder } from '@/lib/libraryOrder'

describe('moveId', () => {
  const ids = [1, 2, 3, 4]

  it('moves an id down and up, the others closing up around it', () => {
    expect(moveId({ ids, id: 1, to: 2 })).toEqual([2, 3, 1, 4])
    expect(moveId({ ids, id: 4, to: 0 })).toEqual([4, 1, 2, 3])
  })

  it('keeps the very same list where nothing moves, and holds an id to the ends', () => {
    expect(moveId({ ids, id: 2, to: 1 })).toBe(ids)
    expect(moveId({ ids, id: 9, to: 1 })).toBe(ids)
    expect(moveId({ ids, id: 2, to: -5 })).toEqual([2, 1, 3, 4])
    expect(moveId({ ids, id: 2, to: 99 })).toEqual([1, 3, 4, 2])
  })
})

describe('sameOrder', () => {
  it('compares the places as well as the ids', () => {
    expect(sameOrder({ a: [1, 2], b: [1, 2] })).toBe(true)
    expect(sameOrder({ a: [1, 2], b: [2, 1] })).toBe(false)
    expect(sameOrder({ a: [1, 2], b: [1] })).toBe(false)
  })
})
