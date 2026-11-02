import { describe, expect, it } from 'bun:test'
import { homeContinueCountOf } from '@/lib/homeContinue'

describe('homeContinueCountOf', () => {
  it('reads a whole number of at least 1', () => {
    expect(homeContinueCountOf({ given: '4' })).toBe(4)
    expect(homeContinueCountOf({ given: '12' })).toBe(12)
  })

  it('keeps six for none, zero, a fraction or words', () => {
    expect(homeContinueCountOf({ given: undefined })).toBe(6)
    expect(homeContinueCountOf({ given: '' })).toBe(6)
    expect(homeContinueCountOf({ given: '0' })).toBe(6)
    expect(homeContinueCountOf({ given: '2.5' })).toBe(6)
    expect(homeContinueCountOf({ given: 'many' })).toBe(6)
  })
})
