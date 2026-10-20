import { describe, expect, it } from 'bun:test'

import { BREAKPOINTS, isTablet } from '@/layouts/screenSizes'

describe('isTablet', () => {
  it('reads a tablet by its shorter side, held either way', () => {
    expect(isTablet({ width: 834, height: 1194 })).toBe(true)
    expect(isTablet({ width: 1194, height: 834 })).toBe(true)
  })

  it('keeps a phone a phone when it is held sideways, wider than a tablet is narrow', () => {
    expect(isTablet({ width: 402, height: 874 })).toBe(false)
    expect(isTablet({ width: 874, height: 402 })).toBe(false)
  })

  it("starts at the web's 48rem", () => {
    expect(isTablet({ width: BREAKPOINTS.tablet, height: 1024 })).toBe(true)
    expect(isTablet({ width: BREAKPOINTS.tablet - 1, height: 1024 })).toBe(false)
  })
})
