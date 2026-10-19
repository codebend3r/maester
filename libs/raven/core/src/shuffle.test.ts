import { describe, expect, it } from 'bun:test'
import { shuffled } from '@/shuffle'

describe('shuffled', () => {
  it('keeps every item once', () => {
    const items = [1, 2, 3, 4, 5, 6, 7, 8]
    expect(shuffled({ items }).toSorted((a, b) => a - b)).toEqual(items)
  })

  it('deals as the die falls', () => {
    expect(shuffled({ items: ['a', 'b', 'c'], roll: () => 0 })).toEqual(['c', 'b', 'a'])
    expect(shuffled({ items: ['a', 'b', 'c'], roll: () => 0.999 })).toEqual(['a', 'b', 'c'])
  })

  it('leaves what it was given alone', () => {
    const items = ['a', 'b', 'c']
    shuffled({ items, roll: () => 0 })
    expect(items).toEqual(['a', 'b', 'c'])
  })

  it('deals nothing from nothing', () => {
    expect(shuffled({ items: [] })).toEqual([])
  })
})
