import { describe, expect, it } from 'bun:test'

import { INKS, WREN_ICONS } from '@/icons'

const SOLID_NAMES = ['more', 'play', 'pause', 'next', 'previous', 'heartFilled']

describe('WREN_ICONS', () => {
  it('draws every icon in at least one shape of path data', () => {
    const drawings = Object.values(WREN_ICONS)
    expect(drawings.every(({ shapes }) => shapes.length > 0)).toBe(true)
    expect(drawings.flatMap(({ shapes }) => shapes).every((shape) => /^[Mm]/.test(shape))).toBe(
      true,
    )
  })

  it('fills only the transport, more and the filled heart, and lines the rest', () => {
    const filled = Object.entries(WREN_ICONS)
      .filter(([, { ink }]) => ink === INKS.fill)
      .map(([name]) => name)
    expect(filled.toSorted()).toEqual(SOLID_NAMES.toSorted())
  })

  it('draws a circle as two half arcs from its left edge', () => {
    expect(WREN_ICONS.album.shapes[1]).toBe('M9.6 12a2.4 2.4 0 1 0 4.8 0a2.4 2.4 0 1 0 -4.8 0Z')
  })

  it('draws a rounded rectangle clockwise from its top left corner', () => {
    expect(WREN_ICONS.grid.shapes[0]).toBe(
      'M5 3.5H9A1.5 1.5 0 0 1 10.5 5V9A1.5 1.5 0 0 1 9 10.5H5A1.5 1.5 0 0 1 3.5 9V5A1.5 1.5 0 0 1 5 3.5Z',
    )
  })
})
