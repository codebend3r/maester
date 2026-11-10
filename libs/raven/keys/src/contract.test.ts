import { describe, expect, it } from 'bun:test'

import { isKeyDown } from '@/contract'

describe('isKeyDown', () => {
  it('accepts a press with its key and modifiers', () => {
    expect(isKeyDown({ key: 'k', isShift: false, isMeta: false })).toBe(true)
    expect(isKeyDown({ key: 'ArrowUp', isShift: true, isMeta: false })).toBe(true)
  })

  it('refuses a press missing a field or in another shape', () => {
    expect(isKeyDown({ key: 'k', isShift: false })).toBe(false)
    expect(isKeyDown({ key: 7, isShift: false, isMeta: false })).toBe(false)
    expect(isKeyDown(null)).toBe(false)
    expect(isKeyDown('k')).toBe(false)
  })
})
