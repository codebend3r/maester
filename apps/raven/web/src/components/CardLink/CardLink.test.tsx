import { describe, expect, it, spyOn } from 'bun:test'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { MemoryRouter, useLocation, useNavigationType } from 'react-router-dom'
import { CardLink } from '@/components/CardLink/CardLink'
import { api } from '@/lib/api'
import { queryClient } from '@/lib/queryClient'
import { renderWithProviders } from '@/test/render'

/** Prints how the page got where it is, where that is, and the state it was handed. */
const Where = () => {
  const { pathname, search, state } = useLocation()
  const type = useNavigationType()
  return <p data-testid="where">{`${type} ${pathname}${search} ${JSON.stringify(state)}`}</p>
}

type RenderLinkProps = { link: ReactNode; route?: string }

const renderLink = ({ link, route = '/libraries/2' }: RenderLinkProps) =>
  renderWithProviders({
    ui: (
      <>
        {link}
        <Where />
      </>
    ),
    route,
  })

const where = () => screen.getByTestId('where').textContent

type IsLeftToTheBrowserProps = { link: HTMLElement; init: MouseEventInit }

/**
 * Clicks `link` and says whether the click was left for the browser to
 * follow, then cancels it, so the test page itself goes nowhere.
 */
const isLeftToTheBrowser = ({ link, init }: IsLeftToTheBrowserProps) => {
  const seen = { isLeft: false }
  const watch = (event: Event) => {
    seen.isLeft = !event.defaultPrevented
    event.preventDefault()
  }
  window.addEventListener('click', watch)
  fireEvent.click(link, init)
  window.removeEventListener('click', watch)
  return seen.isLeft
}

describe('CardLink', () => {
  it("reads its item's page ahead once pointed at a moment, or focused, and not on a pass", async () => {
    const getItem = spyOn(api, 'getItem').mockImplementation(() => new Promise(() => undefined))
    renderLink({
      link: (
        <CardLink to="/movies/40" prefetchItem={40}>
          Busboys
        </CardLink>
      ),
    })
    const link = screen.getByRole('link', { name: 'Busboys' })
    fireEvent.pointerEnter(link)
    fireEvent.pointerLeave(link)
    await new Promise((resolve) => setTimeout(resolve, 200))
    expect(getItem).not.toHaveBeenCalled()
    fireEvent.pointerEnter(link)
    await waitFor(() => expect(getItem).toHaveBeenCalledWith(40))
    getItem.mockClear()
    queryClient.clear()
    fireEvent.focus(link)
    expect(getItem).toHaveBeenCalledWith(40)
    getItem.mockRestore()
    queryClient.clear()
  })

  it('is a link to its address, wearing what it is given', () => {
    renderLink({
      link: (
        <CardLink to="/movies/40" className="title" aria-label="Busboys">
          Busboys
        </CardLink>
      ),
    })
    const link = screen.getByRole('link', { name: 'Busboys' })
    expect(link).toHaveAttribute('href', '/movies/40')
    expect(link).toHaveClass('title')
  })

  it('opens its address in the app on a click, handing over its state', () => {
    renderLink({
      link: (
        <CardLink to="/watch/7" state={{ media: 7 }}>
          Play
        </CardLink>
      ),
    })
    const link = screen.getByRole('link', { name: 'Play' })
    expect(isLeftToTheBrowser({ link, init: { button: 0 } })).toBe(false)
    expect(where()).toBe('PUSH /watch/7 {"media":7}')
  })

  it('leaves a click with a modifier key, or with another button, to the browser', () => {
    renderLink({ link: <CardLink to="/movies/40">Busboys</CardLink> })
    const link = screen.getByRole('link', { name: 'Busboys' })
    const clicks: MouseEventInit[] = [
      { metaKey: true },
      { ctrlKey: true },
      { shiftKey: true },
      { altKey: true },
      { button: 1 },
    ]
    expect(clicks.map((init) => isLeftToTheBrowser({ link, init }))).toEqual(clicks.map(() => true))
    expect(where()).toBe('POP /libraries/2 null')
  })

  it('stays put when its own click handler cancels the click', () => {
    renderLink({
      link: (
        <CardLink to="/movies/40" onClick={(event) => event.preventDefault()}>
          Busboys
        </CardLink>
      ),
    })
    fireEvent.click(screen.getByRole('link', { name: 'Busboys' }))
    expect(where()).toBe('POP /libraries/2 null')
  })

  it('replaces the history entry, rather than adding one, for the page already open', () => {
    renderLink({
      link: <CardLink to="/movies/40?file=7">Busboys</CardLink>,
      route: '/movies/40?file=7',
    })
    fireEvent.click(screen.getByRole('link', { name: 'Busboys' }))
    expect(where()).toBe('REPLACE /movies/40?file=7 null')
  })

  it('fails loudly with nothing above it to follow links', () => {
    const quiet = spyOn(console, 'error').mockImplementation(() => {})
    expect(() =>
      render(
        <MemoryRouter>
          <CardLink to="/movies/40">Busboys</CardLink>
        </MemoryRouter>,
      ),
    ).toThrow('CardLinks')
    quiet.mockRestore()
  })
})
