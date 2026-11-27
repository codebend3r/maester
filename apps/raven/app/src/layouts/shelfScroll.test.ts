import { describe, expect, it } from 'bun:test'

import { farHeightOf, scrollTargetOf } from '@/layouts/shelfScroll'

const VIEW = { offset: 500, viewport: 1000, margin: 20 }

describe('scrollTargetOf', () => {
  it('leaves the shelves alone while the shelf is whole in view', () => {
    expect(scrollTargetOf({ ...VIEW, band: { top: 600, height: 300 } })).toBeNull()
  })

  it('leaves them alone before the view is measured', () => {
    expect(scrollTargetOf({ ...VIEW, viewport: 0, band: { top: 1600, height: 300 } })).toBeNull()
  })

  it('brings a shelf below the view up to its foot, with the margin', () => {
    expect(scrollTargetOf({ ...VIEW, band: { top: 1400, height: 300 } })).toBe(720)
  })

  it('brings a shelf above the view down to its top, never past the start', () => {
    expect(scrollTargetOf({ ...VIEW, band: { top: 200, height: 300 } })).toBe(180)
    expect(scrollTargetOf({ ...VIEW, band: { top: 10, height: 300 } })).toBe(0)
  })

  it('shows a shelf taller than the view from its top', () => {
    expect(scrollTargetOf({ ...VIEW, band: { top: 1600, height: 1200 } })).toBe(1580)
  })
})

describe('farHeightOf', () => {
  const view = { offset: 2000, viewport: 1000 }

  it('draws every shelf while the view is unmeasured', () => {
    expect(farHeightOf({ band: { top: 0, height: 300 }, offset: 2000, viewport: 0 })).toBeNull()
  })

  it('draws a shelf not yet laid out', () => {
    expect(farHeightOf({ band: null, ...view })).toBeNull()
  })

  it('draws a shelf in view, or within half a screen of it', () => {
    expect(farHeightOf({ band: { top: 2400, height: 300 }, ...view })).toBeNull()
    expect(farHeightOf({ band: { top: 1300, height: 300 }, ...view })).toBeNull()
    expect(farHeightOf({ band: { top: 3500, height: 300 }, ...view })).toBeNull()
  })

  it('stands a shelf further off than that in as its height', () => {
    expect(farHeightOf({ band: { top: 1100, height: 300 }, ...view })).toBe(300)
    expect(farHeightOf({ band: { top: 3600, height: 300 }, ...view })).toBe(300)
  })
})
