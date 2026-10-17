import { afterEach, describe, expect, it, jest, spyOn } from 'bun:test'
import { act, cleanup, fireEvent, screen, within } from '@testing-library/react'
import type { ItemDetails } from '@raven/core'
import { api } from '@/lib/api'
import { watchLink } from '@/lib/itemLinks'
import { type Featured } from '@/pages/HomePage/featured'
import { HERO_MS, HomeHero, LESS_MOTION, titleSize } from '@/pages/HomePage/HomeHero'
import { itemDetails, matchedMovie } from '@/test/fixtures'
import { held } from '@/test/held'
import { renderWithProviders } from '@/test/render'

const arrival = (id: number): Featured => ({
  key: `media:${id}`,
  itemId: id + 100,
  poster: `/poster-${id}.jpg`,
  backdrop: `/backdrop-${id}.jpg`,
  eyebrow: 'New in Films',
  title: `Movie ${id}`,
  facts: ['2024', '2h 46m', '4K HDR'],
  addedAt: '2026-10-10T00:00:00.000Z',
  play: watchLink({ media: matchedMovie({ id }) }),
  details: `/movies/${id + 100}?library=2`,
})

const ARRIVALS = [arrival(1), arrival(2), arrival(3)]

const hero = () => screen.getByRole('region', { name: 'Just added' })
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
  const details = spyOn(api, 'getItem')

  const open = (featured: Featured[] = ARRIVALS) => {
    renderWithProviders({ ui: <HomeHero featured={featured} /> })
  }

  afterEach(() => {
    cleanup()
    details.mockReset()
    jest.useRealTimers()
  })

  it('shows the first arrival: where it came, its title and line, Play, its page and what it is', async () => {
    details.mockImplementation(async (id) =>
      itemDetails({ id, summary: `What happens in ${id}.`, tagline: 'Taglines lose.' }),
    )
    open()
    expect(within(slide()).getByText('New in Films')).toBeInTheDocument()
    expect(title()).toBe('Movie 1')
    expect(await within(slide()).findByText('What happens in 101.')).toBeInTheDocument()
    expect(within(hero()).getByRole('link', { name: 'Play Movie 1' })).toHaveAttribute(
      'href',
      '/watch/1',
    )
    expect(within(hero()).getByRole('link', { name: 'Details' })).toHaveAttribute(
      'href',
      '/movies/101?library=2',
    )
    expect(within(slide()).getByText('2024 · 2h 46m · 4K HDR')).toBeInTheDocument()
    expect(slide()).toHaveAccessibleName('1 of 3')
    expect(within(hero()).getByText('1 / 3')).toBeInTheDocument()
    // The others' words keep the hero their height, out of reach.
    expect(hero().querySelectorAll('article')).toHaveLength(3)
    expect(hero().querySelectorAll('article[inert][aria-hidden="true"]')).toHaveLength(2)
    expect(details.mock.calls.map(([id]) => id).toSorted()).toEqual([101, 102, 103])
  })

  it('reads the tagline where the item has no summary, and nothing before either comes', async () => {
    const answer = held<ItemDetails>()
    details.mockImplementation(() => answer.promise)
    open([arrival(1)])
    expect(within(hero()).queryByText('Taglines win.')).toBeNull()
    await act(async () => answer.answer(itemDetails({ summary: null, tagline: 'Taglines win.' })))
    expect(await within(hero()).findByText('Taglines win.')).toBeInTheDocument()
  })

  it('moves on to the next arrival every few seconds, and round again after the last', () => {
    jest.useFakeTimers()
    details.mockImplementation(() => held<ItemDetails>().promise)
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
    details.mockImplementation(() => held<ItemDetails>().promise)
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
    details.mockImplementation(() => held<ItemDetails>().promise)
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
    details.mockImplementation(() => held<ItemDetails>().promise)
    open()
    passTurns(3)
    expect(title()).toBe('Movie 1')
    expect(announced()).toHaveAttribute('aria-live', 'polite')
    matchMedia.mockRestore()
  })

  it('holds still while it is pointed at, and moves on once the pointer leaves', () => {
    jest.useFakeTimers()
    details.mockImplementation(() => held<ItemDetails>().promise)
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
    details.mockImplementation(() => held<ItemDetails>().promise)
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
    details.mockImplementation(() => held<ItemDetails>().promise)
    open([arrival(4)])
    passTurns(2)
    expect(title()).toBe('Movie 4')
    expect(within(hero()).queryByRole('button')).toBeNull()
    expect(fan()).toEqual(['front'])
  })

  it('tucks the arrivals past the ones either side away behind the fan', () => {
    details.mockImplementation(() => held<ItemDetails>().promise)
    open([arrival(1), arrival(2), arrival(3), arrival(4)])
    expect(fan()).toEqual(['front', 'next', 'away', 'previous'])
  })

  it('offers only the page of a show with nothing left to play', () => {
    details.mockImplementation(() => held<ItemDetails>().promise)
    open([{ ...arrival(5), play: null }])
    expect(within(hero()).queryByRole('link', { name: /^Play/ })).toBeNull()
    expect(within(hero()).getByRole('link', { name: 'Details' })).toBeInTheDocument()
  })
})
