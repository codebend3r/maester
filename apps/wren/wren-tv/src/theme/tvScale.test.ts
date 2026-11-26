import { describe, expect, it } from 'bun:test'

import { TV_DESIGN_WIDTH, tvScaleOf } from '@/theme/tvScale'

describe('tvScaleOf', () => {
  it('draws Apple TV at the sizes as written', () => {
    expect(tvScaleOf({ width: TV_DESIGN_WIDTH })).toBe(1)
  })

  it("halves them on a 1080p Android TV's 960 dp window", () => {
    expect(tvScaleOf({ width: 960 })).toBe(0.5)
  })
})
