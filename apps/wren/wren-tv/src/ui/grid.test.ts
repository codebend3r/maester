import { describe, expect, it } from 'bun:test'

import { columnsFitting } from '@/ui/grid'

describe('columnsFitting', () => {
  it('fits as many tiles as the width holds with a gap between each', () => {
    expect(columnsFitting({ width: 1000, tile: 200, gap: 50 })).toBe(4)
  })

  it('counts the last tile without a gap after it', () => {
    expect(columnsFitting({ width: 950, tile: 200, gap: 50 })).toBe(4)
  })

  it('keeps one column where not even one tile fits', () => {
    expect(columnsFitting({ width: 100, tile: 200, gap: 50 })).toBe(1)
  })
})
