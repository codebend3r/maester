import { describe, expect, it } from 'bun:test'
import { isRecord } from '@/guards'

describe('isRecord', () => {
  it('is true for an object and false for null, an array or a primitive', () => {
    expect(isRecord({ a: 1 })).toBe(true)
    expect(isRecord(null)).toBe(false)
    expect(isRecord([])).toBe(false)
    expect(isRecord('a')).toBe(false)
  })
})
