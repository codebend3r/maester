import { describe, expect, it } from 'vitest'
import { sameSecret } from '@/secrets'

describe('sameSecret', () => {
  it('matches the same text', () => {
    expect(sameSecret({ given: 'hunter2', expected: 'hunter2' })).toBe(true)
    expect(sameSecret({ given: '', expected: '' })).toBe(true)
  })

  it('refuses different text, whatever the lengths', () => {
    expect(sameSecret({ given: 'hunter3', expected: 'hunter2' })).toBe(false)
    expect(sameSecret({ given: 'hunter', expected: 'hunter2' })).toBe(false)
    expect(sameSecret({ given: '', expected: 'hunter2' })).toBe(false)
  })
})
