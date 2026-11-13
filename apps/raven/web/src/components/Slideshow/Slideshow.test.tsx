import { afterEach, describe, expect, it, jest, spyOn } from 'bun:test'
import { act, render } from '@testing-library/react'
import { SLIDE_MS, Slideshow, slideRoles } from '@/components/Slideshow/Slideshow'
import { LESS_MOTION } from '@/lib/motion'

const SLIDES = ['a.jpg', 'b.jpg', 'c.jpg', 'd.jpg']

const PICTURES = SLIDES.map((src) => ({ src, srcSet: null }))

describe('slideRoles', () => {
  it('starts on the first, the next laid out unseen', () => {
    expect(slideRoles({ slides: SLIDES, step: 0 })).toEqual([
      { slide: 'a.jpg', role: 'first' },
      { slide: 'b.jpg', role: 'upcoming' },
    ])
  })

  it('brings each in over the one before, in the order they came', () => {
    expect(slideRoles({ slides: SLIDES, step: 2 })).toEqual([
      { slide: 'b.jpg', role: 'previous' },
      { slide: 'c.jpg', role: 'current' },
      { slide: 'd.jpg', role: 'upcoming' },
    ])
  })

  it('goes round again from the last to the first', () => {
    expect(slideRoles({ slides: SLIDES, step: 4 })).toEqual([
      { slide: 'a.jpg', role: 'current' },
      { slide: 'b.jpg', role: 'upcoming' },
      { slide: 'd.jpg', role: 'previous' },
    ])
  })

  it('keeps the one going out in its part when it is also the next', () => {
    expect(slideRoles({ slides: ['a.jpg', 'b.jpg'], step: 1 })).toEqual([
      { slide: 'a.jpg', role: 'previous' },
      { slide: 'b.jpg', role: 'current' },
    ])
  })

  it('shows a lone picture alone, and nothing of none', () => {
    expect(slideRoles({ slides: ['a.jpg'], step: 0 })).toEqual([{ slide: 'a.jpg', role: 'first' }])
    expect(slideRoles({ slides: [], step: 0 })).toEqual([])
  })
})

describe('Slideshow', () => {
  const shown = (container: HTMLElement) =>
    [...container.querySelectorAll('img')].map((img) => img.getAttribute('src'))

  afterEach(() => jest.useRealTimers())

  it('moves on to the next picture every few seconds, first to last and round again', () => {
    jest.useFakeTimers()
    const { container } = render(
      <Slideshow slides={PICTURES.slice(0, 3)} motion="fade" sizes="100vw" />,
    )
    expect(shown(container)).toEqual(['a.jpg', 'b.jpg'])
    act(() => jest.advanceTimersByTime(SLIDE_MS))
    expect(shown(container)).toEqual(['a.jpg', 'b.jpg', 'c.jpg'])
    act(() => jest.advanceTimersByTime(SLIDE_MS * 2))
    expect(shown(container)).toEqual(['a.jpg', 'b.jpg', 'c.jpg'])
    expect(container.querySelector('img[src="a.jpg"]')?.className).toContain('current')
  })

  it('holds the first picture for a browser that asks for less motion', () => {
    jest.useFakeTimers()
    const real = window.matchMedia.bind(window)
    // `all` matches any screen and `not all` none, so only the ask for less motion holds.
    const matchMedia = spyOn(window, 'matchMedia').mockImplementation((query) =>
      real(query === LESS_MOTION ? 'all' : 'not all'),
    )
    const { container } = render(<Slideshow slides={PICTURES} motion="slide" sizes="100vw" />)
    act(() => jest.advanceTimersByTime(SLIDE_MS * 3))
    expect(container.querySelector('img[src="a.jpg"]')?.className).toContain('first')
    matchMedia.mockRestore()
  })

  it("offers a slide's narrower copies at the width it shows, and no sizes for a slide with none", () => {
    const { container } = render(
      <Slideshow
        slides={[
          { src: 'a.jpg', srcSet: 'a-480.jpg 480w, a.jpg 1280w' },
          { src: 'b.jpg', srcSet: null },
        ]}
        motion="fade"
        sizes="100vw"
      />,
    )
    const first = container.querySelector('img[src="a.jpg"]')
    expect(first).toHaveAttribute('srcset', 'a-480.jpg 480w, a.jpg 1280w')
    expect(first).toHaveAttribute('sizes', '100vw')
    const second = container.querySelector('img[src="b.jpg"]')
    expect(second).not.toHaveAttribute('srcset')
    expect(second).not.toHaveAttribute('sizes')
  })
})
