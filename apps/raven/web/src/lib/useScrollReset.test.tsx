import { afterEach, describe, expect, it } from 'bun:test'
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Link, Outlet, RouterProvider, createMemoryRouter } from 'react-router-dom'
import { useScrollReset } from '@/lib/useScrollReset'
import { pageWithoutLayout } from '@/test/scrolling'

/** The entries the library lists, in its order: a test may deal them again. */
const listing = { entries: ['media:1', 'media:2', 'media:3'] }

const Shell = () => {
  useScrollReset()
  return <Outlet />
}

const Library = () => (
  <ul>
    {listing.entries.map((entry) => (
      <li key={entry} data-entry={entry}>
        <Link to="/movie">{entry}</Link>
      </li>
    ))}
  </ul>
)

const cleanups: Array<() => void> = []

/** The library in a page with no layout, its cards 300 px tall and 100 apart. */
const setUp = () => {
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
    ],
    { initialEntries: ['/library'] },
  )
  render(<RouterProvider router={router} />)
  const cards = () => Array.from(document.querySelectorAll<HTMLElement>('[data-entry]'))
  /** Lays the cards out from `start` down, as a browser that has drawn them would. */
  const layOut = (start = 0) =>
    cards().forEach((card, index) => page.place({ element: card, top: start + index * 400 }))
  cleanups.push(page.restore)
  return { page, router, cards, layOut }
}

describe('useScrollReset', () => {
  afterEach(() => {
    cleanups.splice(0).forEach((cleanup) => cleanup())
    listing.entries = ['media:1', 'media:2', 'media:3']
  })

  it('puts the card that was at the top back where it was, on going back to the page', async () => {
    const { page, router, cards, layOut } = setUp()
    layOut()
    page.scrollTo(450)
    window.dispatchEvent(new Event('scroll'))
    await new Promise((resolve) => setTimeout(resolve, 200))
    await act(() => router.navigate('/movie'))
    await act(() => router.navigate(-1))
    // The browser scrolls back as far as it was, but the cards above stood
    // in shorter than they turn out once drawn.
    layOut(120)
    page.scrollTo(450)
    page.frame()
    expect(cards()[1]?.getBoundingClientRect().top).toBe(-50)
  })

  it('notes the card at the top as a click leads away, before the scroll settles', async () => {
    const { page, router, cards, layOut } = setUp()
    layOut()
    page.scrollTo(450)
    window.dispatchEvent(new Event('scroll'))
    await userEvent.click(screen.getByRole('link', { name: 'media:2' }))
    await act(() => router.navigate(-1))
    layOut(120)
    page.scrollTo(450)
    page.frame()
    expect(cards()[1]?.getBoundingClientRect().top).toBe(-50)
  })

  it('leaves the scroll to the browser when the cards come back in another order', async () => {
    const { page, router, cards, layOut } = setUp()
    layOut()
    page.scrollTo(450)
    await userEvent.click(screen.getByRole('link', { name: 'media:2' }))
    listing.entries = ['media:3', 'media:1', 'media:2']
    await act(() => router.navigate(-1))
    layOut(120)
    page.scrollTo(450)
    page.frame()
    expect(window.scrollY).toBe(450)
    expect(cards()[1]?.getBoundingClientRect().top).toBe(70)
  })

  it('opens a page a link leads to at its top', async () => {
    const { page, layOut } = setUp()
    layOut()
    page.scrollTo(450)
    await userEvent.click(screen.getByRole('link', { name: 'media:2' }))
    expect(window.scrollY).toBe(0)
  })
})
