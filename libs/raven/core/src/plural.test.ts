import { describe, expect, it } from 'bun:test'
import { plural } from '@/plural'

describe('plural', () => {
  it('uses the singular word for exactly one', () => {
    expect(plural({ n: 1, one: 'file', many: 'files' })).toBe('1 file')
  })

  it('uses the plural word for zero and for many, with thousands separated', () => {
    expect(plural({ n: 0, one: 'file', many: 'files' })).toBe('0 files')
    expect(plural({ n: 1200, one: 'file', many: 'files' })).toBe('1,200 files')
  })
})
