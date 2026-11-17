import { describe, expect, it } from 'bun:test'

import { tileWidthOf } from '@/ui/tileWidth'

describe('tileWidthOf', () => {
  it('fits the columns and their gaps into the width, in whole points', () => {
    expect(tileWidthOf({ width: 350, columns: 2, gap: 14 })).toBe(168)
    expect(tileWidthOf({ width: 858, columns: 5, gap: 14 })).toBe(160)
  })

  it('never goes below nothing', () => {
    expect(tileWidthOf({ width: 10, columns: 2, gap: 14 })).toBe(0)
  })
})
