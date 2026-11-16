import { describe, expect, it } from 'bun:test'

import { isScrolledAway } from '@/layouts/scrollHome'

describe('isScrolledAway', () => {
  it('holds the button back at the top, through a pull past it and a small nudge', () => {
    expect(isScrolledAway(0)).toBe(false)
    expect(isScrolledAway(-80)).toBe(false)
    expect(isScrolledAway(160)).toBe(false)
  })

  it('offers the way back once the header has scrolled away', () => {
    expect(isScrolledAway(161)).toBe(true)
    expect(isScrolledAway(4000)).toBe(true)
  })
})
