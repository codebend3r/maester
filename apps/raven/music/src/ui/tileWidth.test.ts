import { describe, expect, it } from 'bun:test'

import { columnsFitting, tileWidthOf } from '@/ui/tileWidth'

describe('tileWidthOf', () => {
  it('fits the columns and their gaps into the width, in whole points', () => {
    expect(tileWidthOf({ width: 350, columns: 2, gap: 14 })).toBe(168)
    expect(tileWidthOf({ width: 858, columns: 5, gap: 14 })).toBe(160)
  })

  it('never goes below nothing', () => {
    expect(tileWidthOf({ width: 10, columns: 2, gap: 14 })).toBe(0)
  })
})

describe('columnsFitting', () => {
  it('fits as many tiles of a size as the width holds, their gaps between them', () => {
    expect(columnsFitting({ width: 350, tile: 160, gap: 14 })).toBe(2)
    expect(columnsFitting({ width: 334, tile: 160, gap: 14 })).toBe(2)
    expect(columnsFitting({ width: 333, tile: 160, gap: 14 })).toBe(1)
    expect(columnsFitting({ width: 858, tile: 96, gap: 14 })).toBe(7)
  })

  it('keeps one column on a width narrower than a tile', () => {
    expect(columnsFitting({ width: 200, tile: 288, gap: 14 })).toBe(1)
  })
})
