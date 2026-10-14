import { afterEach, describe, expect, it, spyOn } from 'bun:test'
import { holdInPlace } from '@/lib/holdInPlace'
import { pageWithoutLayout } from '@/test/scrolling'

const cleanups: Array<() => void> = []

/** A card in a page with no layout, sitting 5,000 px down it. */
const setUp = () => {
  const page = pageWithoutLayout()
  const card = document.createElement('li')
  document.body.append(card)
  page.place({ element: card, top: 5000 })
  cleanups.push(() => {
    card.remove()
    page.restore()
  })
  return { page, card, top: () => card.getBoundingClientRect().top }
}

describe('holdInPlace', () => {
  afterEach(() => {
    cleanups.splice(0).forEach((cleanup) => cleanup())
  })

  it('puts a card back where it was when the cards drawn above it move it', () => {
    const { page, card, top } = setUp()
    page.scrollTo(4900)
    holdInPlace({ card, top: 100 })
    // Drawn, the cards above turn out taller than they stood in at, then one shorter.
    page.place({ element: card, top: 5240 })
    page.frame()
    expect(top()).toBe(100)
    page.place({ element: card, top: 5180 })
    page.frame()
    expect(top()).toBe(100)
  })

  it('lets go once the card has held still for a few frames', () => {
    const { page, card } = setUp()
    page.scrollTo(5000)
    holdInPlace({ card, top: 0 })
    page.frame(3)
    expect(page.isWaiting()).toBe(true)
    page.frame()
    expect(page.isWaiting()).toBe(false)
  })

  it('lets go when the page can scroll no further, short of the spot', () => {
    const { page, card } = setUp()
    page.scrollTo(4000)
    // At the foot of the page, so scrolling on leaves it where it is.
    const scroll = spyOn(window, 'scrollBy').mockImplementation(() => undefined)
    cleanups.push(() => scroll.mockRestore())
    holdInPlace({ card, top: 0 })
    page.frame(4)
    expect(scroll).toHaveBeenCalled()
    expect(page.isWaiting()).toBe(false)
  })

  it('stops the moment the viewer scrolls', () => {
    const { page, card, top } = setUp()
    page.scrollTo(5000)
    holdInPlace({ card, top: 0 })
    window.dispatchEvent(new Event('wheel'))
    page.place({ element: card, top: 5300 })
    page.frame()
    expect(top()).toBe(300)
  })

  it('stops when told to', () => {
    const { page, card, top } = setUp()
    page.scrollTo(5000)
    const stop = holdInPlace({ card, top: 0 })
    stop()
    page.place({ element: card, top: 5300 })
    page.frame()
    expect(top()).toBe(300)
    expect(page.isWaiting()).toBe(false)
  })

  it('stops when the card leaves the page', () => {
    const { page, card } = setUp()
    page.scrollTo(5000)
    holdInPlace({ card, top: 0 })
    card.remove()
    page.place({ element: card, top: 5300 })
    page.frame()
    expect(window.scrollY).toBe(5000)
  })

  it('after a smooth scroll, waits for it to end before putting the card back', () => {
    const { page, card, top } = setUp()
    holdInPlace({ card, top: 0, afterScroll: true })
    page.frame()
    // The scroll gets under way, and the cards drawn on the way move the card down.
    page.scrollTo(2500)
    page.place({ element: card, top: 5150 })
    page.frame()
    page.scrollTo(4800)
    page.frame()
    expect(window.scrollY).toBe(4800)
    page.scrollTo(5000)
    page.frame()
    expect(top()).toBe(150)
    // It has come to rest, short of the card.
    page.frame()
    expect(top()).toBe(0)
  })

  it('after a smooth scroll that never gets under way, holds the card all the same', () => {
    const { page, card, top } = setUp()
    page.scrollTo(5000)
    holdInPlace({ card, top: 0, afterScroll: true })
    page.place({ element: card, top: 5100 })
    page.frame(12)
    expect(top()).toBe(0)
  })
})
