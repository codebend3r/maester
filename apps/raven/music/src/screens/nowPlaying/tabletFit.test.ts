import { describe, expect, it } from 'bun:test'

import { tabletFitOf } from '@/screens/nowPlaying/tabletFit'
import { PLAYER_SIZES } from '@/theme/wrenTokens'

describe('tabletFitOf', () => {
  it('gives the first row three fifths of the height and the player three tenths of the width', () => {
    const { topHeight, playerWidth } = tabletFitOf({ width: 1000, height: 800 })
    expect(topHeight).toBeCloseTo(480)
    expect(playerWidth).toBeCloseTo(300)
  })

  it("fits the cover to the row's height where that is the shorter", () => {
    // An 11 inch iPad held sideways: 500 points of row, less 228 for the controls.
    expect(tabletFitOf({ width: 1194, height: 834 }).art).toBeCloseTo(272.4)
  })

  it("fits the cover to the column's width where that is the narrower", () => {
    expect(tabletFitOf({ width: 800, height: 1200 }).art).toBeCloseTo(184)
  })

  it("never draws the cover larger than the tablet's, or smaller than a row's", () => {
    expect(tabletFitOf({ width: 3000, height: 2000 }).art).toBe(PLAYER_SIZES.tabletArt)
    expect(tabletFitOf({ width: 400, height: 300 }).art).toBe(PLAYER_SIZES.compactArt)
  })
})
