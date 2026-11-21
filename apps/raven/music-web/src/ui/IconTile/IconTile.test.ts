import { describe, expect, it } from 'bun:test'
import { TILE_TONES } from '@/ui/IconTile/IconTile'

describe('IconTile', () => {
  it('names both tones of an icon tile', () => {
    expect(TILE_TONES).toEqual({ quiet: 'quiet', accent: 'accent' })
  })
})
