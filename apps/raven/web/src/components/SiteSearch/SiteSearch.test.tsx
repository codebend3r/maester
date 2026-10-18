import { afterEach, describe, expect, it } from 'bun:test'
import { act, cleanup, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Link, Route, Routes, useLocation } from 'react-router-dom'
import { SiteSearch } from '@/components/SiteSearch/SiteSearch'
import { renderWithProviders } from '@/test/render'

const AddressProbe = () => {
  const { pathname, search } = useLocation()
  return <output aria-label="Current address">{`${pathname}${search}`}</output>
}

const open = (route: string) =>
  renderWithProviders({
    ui: (
      <>
        <AddressProbe />
        <SiteSearch />
        <Routes>
          <Route index element={<p>home</p>} />
          <Route path="movies/:id" element={<Link to="/movies/2">Another movie</Link>} />
        </Routes>
      </>
    ),
    route,
  })

const searchbox = () => screen.getByRole('searchbox', { name: 'Search every library' })
const address = () => screen.getByLabelText('Current address')

describe('SiteSearch', () => {
  afterEach(() => {
    cleanup()
  })

  it('starts empty away from home, whatever the page asks for', () => {
    open('/movies/1?q=bus')
    expect(searchbox()).toHaveValue('')
  })

  it('opens home on a search made from any other page, keeping what is typed', async () => {
    open('/movies/1')
    await userEvent.type(searchbox(), 'bus')
    await waitFor(() => expect(address()).toHaveTextContent(/^\/\?q=bus$/))
    expect(screen.getByText('home')).toBeInTheDocument()
    expect(searchbox()).toHaveValue('bus')
  })

  it('leaves a page alone until something is typed', async () => {
    open('/movies/1')
    await act(async () => {
      await userEvent.click(screen.getByRole('link', { name: 'Another movie' }))
    })
    expect(address()).toHaveTextContent(/^\/movies\/2$/)
  })

  it('empties once a page other than home opens', async () => {
    renderWithProviders({
      ui: (
        <>
          <AddressProbe />
          <SiteSearch />
          <Routes>
            <Route index element={<Link to="/movies/1">Busboys</Link>} />
            <Route path="movies/:id" element={<p>movie</p>} />
          </Routes>
        </>
      ),
      route: '/?q=bus',
    })
    expect(searchbox()).toHaveValue('bus')
    await act(async () => {
      await userEvent.click(screen.getByRole('link', { name: 'Busboys' }))
    })
    await waitFor(() => expect(searchbox()).toHaveValue(''))
    expect(address()).toHaveTextContent(/^\/movies\/1$/)
  })
})
