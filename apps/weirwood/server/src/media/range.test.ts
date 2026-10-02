import { describe, expect, it } from 'vitest'
import { parseRange } from '@/media/range.js'

describe('parseRange', () => {
  const size = 1000

  it.each([
    ['bytes=0-99', { start: 0, end: 99 }],
    ['bytes=500-', { start: 500, end: 999 }],
    ['bytes=900-5000', { start: 900, end: 999 }],
    ['bytes=-100', { start: 900, end: 999 }],
    ['bytes=-5000', { start: 0, end: 999 }],
    ['bytes=0-0,10-20', { start: 0, end: 0 }],
  ])('reads %s', (header, expected) => {
    expect(parseRange({ header, size })).toEqual(expected)
  })

  it.each(['bytes=1000-', 'bytes=50-10', 'bytes=-0'])('refuses %s', (header) => {
    expect(parseRange({ header, size })).toBe('unsatisfiable')
  })

  it.each([undefined, '', 'items=0-10', 'bytes=-'])('serves everything for %s', (header) => {
    expect(parseRange({ header, size })).toBeNull()
  })
})
