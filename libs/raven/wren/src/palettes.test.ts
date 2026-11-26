import { describe, expect, it } from 'bun:test'

import { WREN_PALETTES } from '@/palettes'
import { WREN_THEMES } from '@/themes'

describe('WREN_PALETTES', () => {
  it('gives every theme a palette', () => {
    expect(Object.keys(WREN_PALETTES).toSorted()).toEqual(Object.values(WREN_THEMES).toSorted())
  })

  it('gives every palette the same colours, so a theme never lacks one a screen paints with', () => {
    const names = Object.keys(WREN_PALETTES.night).toSorted()
    Object.values(WREN_PALETTES).forEach((palette) => {
      expect(Object.keys(palette).toSorted()).toEqual(names)
    })
  })
})
