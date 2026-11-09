import { describe, expect, it } from 'bun:test'

import { scrollTargetOf } from '@/layouts/shelfScroll'

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
