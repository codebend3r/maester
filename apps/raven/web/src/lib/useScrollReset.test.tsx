import { afterEach, describe, expect, it } from 'bun:test'
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useEffect } from 'react'
import {
  Link,
  Outlet,
  RouterProvider,
  createMemoryRouter,
  useLocation,
  useSearchParams,
} from 'react-router-dom'
import { TopCardNote, useScrollReset } from '@/lib/useScrollReset'
import { pageWithoutLayout } from '@/test/scrolling'

/** The entries the library lists, in its order: a test may deal them again. */
const listing = { entries: ['media:1', 'media:2', 'media:3'] }

/** The app's shell: the hook, and the note around the outlet. */
const Shell = () => {
  const { key } = useLocation()
  useScrollReset()
  return (
    <TopCardNote pageKey={key}>
      <Outlet />
    </TopCardNote>
  )
}

/**
 * The cards, each with a way to a page, to the player and to another
 * order. Arriving, it writes its address again with replace, as a library
 * page writes its search into it, which gives the entry a new key.
 */
const Library = () => {
  const [, setAddress] = useSearchParams()
  useEffect(() => {
    setAddress((current) => current, { replace: true })
  }, [setAddress])
  return (
    <ul>
      {listing.entries.map((entry) => (
        <li key={entry} data-entry={entry}>
          <Link to="/movie">{entry}</Link>
          <Link to="/watch">Play {entry}</Link>
          <Link to="/library?sort=added">Sort {entry}</Link>
        </li>
      ))}
    </ul>
  )
}

const cleanups: Array<() => void> = []

/**
 * The library in a page with no layout, its cards 300 px tall and 100
 * apart, and the player outside the shell, as the app has it.
 */
const setUp = ({ entries = ['/library'] }: { entries?: string[] } = {}) => {
  const page = pageWithoutLayout()
  const router = createMemoryRouter(
    [
      {
        element: <Shell />,
        children: [
          { path: '/library', element: <Library /> },
          { path: '/movie', element: <p>A movie</p> },
        ],
      },
      { path: '/watch', element: <p>The player</p> },
    ],
    { initialEntries: entries, initialIndex: entries.length - 1 },
  )
  render(<RouterProvider router={router} />)
  const cards = () => Array.from(document.querySelectorAll<HTMLElement>('[data-entry]'))
  /** Lays the cards out from `start` down, as a browser that has drawn them would. */
  const layOut = (start = 0) =>
    cards().forEach((card, index) => page.place({ element: card, top: start + index * 400 }))
  const topOf = (index: number) => cards()[index]?.getBoundingClientRect().top ?? Number.NaN
  cleanups.push(page.restore)
  return { page, router, layOut, topOf }
}

describe('useScrollReset', () => {
  afterEach(() => {
    cleanups.splice(0).forEach((cleanup) => cleanup())
    listing.entries = ['media:1', 'media:2', 'media:3']
  })

  it('puts the card that was at the top back where it was, on going back to the page', async () => {
    const { page, router, layOut, topOf } = setUp()
    layOut()
    page.scrollTo(450)
    await act(() => router.navigate('/movie'))
    await act(() => router.navigate(-1))
    // The browser scrolls back as far as it was, but the cards above stood
    // in shorter than they turn out once drawn.
    layOut(120)
    page.scrollTo(450)
    page.frame()
    expect(topOf(1)).toBe(-50)
  })

  it('notes the card at the top as a link leads away, however soon after a scroll', async () => {
    const { page, router, layOut, topOf } = setUp()
    layOut()
    page.scrollTo(450)
    window.dispatchEvent(new Event('scroll'))
    await userEvent.click(screen.getByRole('link', { name: 'media:2' }))
    await act(() => router.navigate(-1))
    layOut(120)
    page.scrollTo(450)
    page.frame()
    expect(topOf(1)).toBe(-50)
  })

  it('notes the card at the top as Back leaves the page, however soon after a scroll', async () => {
    const { page, router, layOut, topOf } = setUp({ entries: ['/movie', '/library'] })
    layOut()
    page.scrollTo(450)
    window.dispatchEvent(new Event('scroll'))
    await act(() => router.navigate(-1))
    await act(() => router.navigate(1))
    layOut(120)
    page.scrollTo(450)
    page.frame()
    expect(topOf(1)).toBe(-50)
  })

  it('puts the card back on coming back from the player, a page outside the shell', async () => {
    const { page, router, layOut, topOf } = setUp()
    layOut()
    page.scrollTo(450)
    await userEvent.click(screen.getByRole('link', { name: 'Play media:2' }))
    expect(screen.getByText('The player')).toBeInTheDocument()
    await act(() => router.navigate(-1))
    layOut(120)
    page.scrollTo(450)
    page.frame()
    expect(topOf(1)).toBe(-50)
  })

  it('stops holding one card when a second Back moves on before it settles', async () => {
    const { page, router, layOut, topOf } = setUp()
    layOut()
    page.scrollTo(450)
    // A sort writes a new entry for the same page, whose cards stay.
    await userEvent.click(screen.getByRole('link', { name: 'Sort media:2' }))
    page.scrollTo(850)
    await userEvent.click(screen.getByRole('link', { name: 'media:3' }))
    await act(() => router.navigate(-2))
    await act(() => router.navigate(1))
    layOut(120)
    page.scrollTo(850)
    page.frame(10)
    expect(topOf(2)).toBe(-50)
    expect(page.isWaiting()).toBe(false)
  })

  it('leaves the scroll to the browser when the cards come back in another order', async () => {
    const { page, router, layOut, topOf } = setUp()
    layOut()
    page.scrollTo(450)
    await userEvent.click(screen.getByRole('link', { name: 'media:2' }))
    listing.entries = ['media:3', 'media:1', 'media:2']
    await act(() => router.navigate(-1))
    layOut(120)
    page.scrollTo(450)
    page.frame()
    expect(window.scrollY).toBe(450)
    expect(topOf(1)).toBe(70)
  })

  it('opens a page a link leads to at its top', async () => {
    const { page, layOut } = setUp()
    layOut()
    page.scrollTo(450)
    await userEvent.click(screen.getByRole('link', { name: 'media:2' }))
    expect(window.scrollY).toBe(0)
  })
})
