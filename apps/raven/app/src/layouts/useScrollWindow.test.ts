import { describe, expect, it } from 'bun:test'

import { isNearEnd } from '@/layouts/useScrollWindow'

describe('isNearEnd', () => {
  it('waits for the screen to be measured', () => {
    expect(isNearEnd({ offset: 0, viewport: 0, content: 100 })).toBe(false)
  })

  it('is true when a quarter of a screen or less is drawn below the view', () => {
    expect(isNearEnd({ offset: 0, viewport: 1000, content: 1000 })).toBe(true)
    expect(isNearEnd({ offset: 0, viewport: 1000, content: 1250 })).toBe(true)
  })

  it('is false while more than that is drawn below', () => {
    expect(isNearEnd({ offset: 0, viewport: 1000, content: 1251 })).toBe(false)
    expect(isNearEnd({ offset: 500, viewport: 1000, content: 3000 })).toBe(false)
  })

  it('is true again once the page has scrolled toward the end', () => {
    expect(isNearEnd({ offset: 1750, viewport: 1000, content: 3000 })).toBe(true)
  })
})
