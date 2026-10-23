import { describe, expect, it } from 'bun:test'

import { LINE_RATIO, linesHeightOf } from '@/layouts/textHeights'

describe('linesHeightOf', () => {
  it('stands each line at its size times the line ratio', () => {
    expect(linesHeightOf({ sizes: [16], fontScale: 1 })).toBe(16 * LINE_RATIO)
    expect(linesHeightOf({ sizes: [16, 12], fontScale: 1 })).toBe(28 * LINE_RATIO)
  })

  it('grows with the text size the viewer set, as React Native scales the lines', () => {
    expect(linesHeightOf({ sizes: [16, 12], fontScale: 2 })).toBe(56 * LINE_RATIO)
  })
})
