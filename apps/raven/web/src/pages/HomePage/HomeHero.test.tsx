import { afterEach, describe, expect, it, jest, spyOn } from 'bun:test'
import { act, cleanup, fireEvent, screen, within } from '@testing-library/react'
import { RESOLUTIONS, watchLink } from '@raven/core'
import { type Featured } from '@/pages/HomePage/featured'
import { HERO_MS, HomeHero, LESS_MOTION, titleSize } from '@/pages/HomePage/HomeHero'
import { matchedMovie } from '@/test/fixtures'
import { renderWithProviders } from '@/test/render'

const arrival = (id: number): Featured => ({
  key: `media:${id}`,
  poster: `/poster-${id}.jpg`,
  backdrop: `/backdrop-${id}.jpg`,
  eyebrow: 'Featured in Films',
  title: `Movie ${id}`,
  facts: ['2024', '2h 46m'],
  picture: { resolution: RESOLUTIONS.uhd, isHdr: true },
  line: `What happens in ${id}.`,
  play: watchLink({ media: matchedMovie({ id }) }),
  details: `/movies/${id + 100}?library=2`,
})

const ARRIVALS = [arrival(1), arrival(2), arrival(3)]

const hero = () => screen.getByRole('region', { name: 'Featured' })
const title = () => within(hero()).getByRole('heading', { level: 2 }).textContent
const slide = () => within(hero()).getByRole('article')
const announced = () => hero().querySelector('[aria-live]')

/** The posters in the fan, in order, by the place each holds. */
const fan = () =>
  [...hero().querySelectorAll('img[src^="/poster"]')].map((poster) =>
    ['front', 'next', 'previous', 'away'].find((place) => poster.className.includes(place)),
  )

/** Lets `turns` turns go by, one at a time, as each schedules the next once it has drawn. */
const passTurns = (turns: number) =>
  Array.from({ length: turns }).forEach(() => act(() => jest.advanceTimersByTime(HERO_MS)))

/** Lets `matchMedia` match only the ask for less motion; `all` matches any screen, `not all` none. */
const askForLessMotion = () => {
  const real = window.matchMedia.bind(window)
  return spyOn(window, 'matchMedia').mockImplementation((query) =>
    real(query === LESS_MOTION ? 'all' : 'not all'),
  )
}

describe('titleSize', () => {
  it('sets a short title as big as it goes', () => {
    expect(titleSize('Dune')).toBe('display')
    expect(titleSize('Eternally Yours')).toBe('display')
  })

  it('steps a longer title down, and one with a long word', () => {
    expect(titleSize('The Autopsy of Jane Doe')).toBe('long')
    expect(titleSize('Oppenheimer')).toBe('long')
  })

  it('steps a very long title down again', () => {
    expect(titleSize('The Lord of the Rings: The Fellowship of the Ring')).toBe('longest')
  })
})

describe('HomeHero', () => {
  const open = (featured: Featured[] = ARRIVALS) => {
    renderWithProviders({ ui: <HomeHero featured={featured} /> })
  }

  afterEach(() => {
    cleanup()
    jest.useRealTimers()
  })

  it('shows the first arrival: where it is, its title and line, Play, its page and what it is', () => {
    open()
    expect(within(slide()).getByText('Featured in Films')).toBeInTheDocument()
    expect(title()).toBe('Movie 1')
    expect(within(slide()).getByText('What happens in 1.')).toBeInTheDocument()
    expect(within(hero()).getByRole('link', { name: 'Play Movie 1' })).toHaveAttribute(
      'href',
      '/watch/1',
    )
    expect(within(hero()).getByRole('link', { name: 'Details' })).toHaveAttribute(
      'href',
      '/movies/101?library=2',
    )
    // The resolution wears the chip every page marks it with, and still reads as words.
    const resolution = within(slide()).getByLabelText('Video resolution: 4K')
    expect(resolution.closest('p')).toHaveTextContent('2024 · 2h 46m · 4K HDR')
    expect(slide()).toHaveAccessibleName('1 of 3')
    expect(within(hero()).getByText('1 / 3')).toBeInTheDocument()
    // The others' words keep the hero their height, out of reach.
    expect(hero().querySelectorAll('article')).toHaveLength(3)
    expect(hero().querySelectorAll('article[inert][aria-hidden="true"]')).toHaveLength(2)
  })

  it('fetches only the posters in view and the one the next turn brings in', () => {
    open(Array.from({ length: 10 }, (_, index) => arrival(index + 1)))
    expect(fan()).toHaveLength(4)
  })

  it('moves on to the next arrival every few seconds, and round again after the last', () => {
    jest.useFakeTimers()
    open()
    expect(fan()).toEqual(['front', 'next', 'previous'])
    passTurns(1)
    expect(title()).toBe('Movie 2')
    expect(slide()).toHaveAccessibleName('2 of 3')
    expect(fan()).toEqual(['previous', 'front', 'next'])
    expect(hero().querySelector('img[class*="shown"]')?.getAttribute('src')).toBe('/backdrop-2.jpg')
    passTurns(2)
    expect(title()).toBe('Movie 1')
    // Moving on by itself, it keeps quiet rather than talk over the page.
    expect(announced()).toHaveAttribute('aria-live', 'off')
  })

  it('steps back and on by hand, round the ends, and says where it landed', () => {
    jest.useFakeTimers()
    open()
    fireEvent.click(within(hero()).getByRole('button', { name: 'Previous' }))
    expect(title()).toBe('Movie 3')
    expect(within(hero()).getByText('3 / 3')).toBeInTheDocument()
    expect(announced()).toHaveTextContent('Movie 3, 3 of 3')
    fireEvent.click(within(hero()).getByRole('button', { name: 'Next' }))
    fireEvent.click(within(hero()).getByRole('button', { name: 'Next' }))
    expect(title()).toBe('Movie 2')
  })

  it('steps with the arrow keys on its controls, and lets other keys be', () => {
    open()
    const next = within(hero()).getByRole('button', { name: 'Next' })
    fireEvent.keyDown(next, { key: 'ArrowRight' })
    expect(title()).toBe('Movie 2')
    fireEvent.keyDown(next, { key: 'ArrowLeft' })
    fireEvent.keyDown(next, { key: 'ArrowLeft' })
    expect(title()).toBe('Movie 3')
    fireEvent.keyDown(next, { key: 'Enter' })
    expect(title()).toBe('Movie 3')
  })

  it('holds still for a browser that asks for less motion, and says where a step lands', () => {
    jest.useFakeTimers()
    const matchMedia = askForLessMotion()
    open()
    passTurns(3)
    expect(title()).toBe('Movie 1')
    expect(announced()).toHaveAttribute('aria-live', 'polite')
    matchMedia.mockRestore()
  })

  it('holds still while it is pointed at, and moves on once the pointer leaves', () => {
    jest.useFakeTimers()
    open()
    fireEvent.pointerEnter(hero())
    passTurns(2)
    expect(title()).toBe('Movie 1')
    fireEvent.pointerLeave(hero())
    passTurns(1)
    expect(title()).toBe('Movie 2')
  })

  it('holds still while the focus is inside it, and moves on once the focus leaves', () => {
    jest.useFakeTimers()
    open()
    const previous = within(hero()).getByRole('button', { name: 'Previous' })
    act(() => within(hero()).getByRole('button', { name: 'Next' }).focus())
    act(() => previous.focus())
    passTurns(2)
    expect(title()).toBe('Movie 1')
    act(() => previous.blur())
    passTurns(1)
    expect(title()).toBe('Movie 2')
  })

  it('shows a lone arrival on its own, still, with nothing to step through', () => {
    jest.useFakeTimers()
    open([arrival(4)])
    passTurns(2)
    expect(title()).toBe('Movie 4')
    expect(within(hero()).queryByRole('button')).toBeNull()
    expect(fan()).toEqual(['front'])
  })

  it('tucks the arrivals past the ones either side away behind the fan', () => {
    open([arrival(1), arrival(2), arrival(3), arrival(4)])
    expect(fan()).toEqual(['front', 'next', 'away', 'previous'])
  })

  it('offers only the page of a show with nothing left to play', () => {
    open([{ ...arrival(5), play: null }])
    expect(within(hero()).queryByRole('link', { name: /^Play/ })).toBeNull()
    expect(within(hero()).getByRole('link', { name: 'Details' })).toBeInTheDocument()
  })
})
