import { afterEach, describe, expect, it } from 'bun:test'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route, Routes, useLocation } from 'react-router-dom'
import { BackButton } from '@/components/BackButton/BackButton'
import { renderWithProviders } from '@/test/render'

const Probe = () => <p>{`at ${useLocation().pathname}`}</p>

const app = (fallback: { to: string; label: string } | null) => (
  <Routes>
    <Route path="movies/3" element={<Probe />} />
    <Route path="people/7" element={<BackButton fallback={fallback} />} />
  </Routes>
)

const FALLBACK = { to: '/libraries/2', label: 'Movies' }

afterEach(() => window.history.replaceState(null, ''))

describe('BackButton', () => {
  it('steps back to the page behind it', async () => {
    renderWithProviders({ ui: app(FALLBACK), route: '/people/7', behind: ['/movies/3'] })
    await userEvent.click(screen.getByRole('button', { name: 'Back' }))
    expect(await screen.findByText('at /movies/3')).toBeInTheDocument()
  })

  it('links to the fallback when nothing of the app is behind it', () => {
    renderWithProviders({ ui: app(FALLBACK), route: '/people/7' })
    expect(screen.getByRole('link', { name: 'Movies' })).toHaveAttribute('href', '/libraries/2')
    expect(screen.queryByRole('button', { name: 'Back' })).toBeNull()
  })

  it('shows nothing with no page behind and no fallback', () => {
    renderWithProviders({ ui: app(null), route: '/people/7' })
    expect(screen.queryByRole('button', { name: 'Back' })).toBeNull()
    expect(screen.queryByRole('link')).toBeNull()
  })

  it("trusts the browser router's history index over the location key", () => {
    window.history.replaceState({ idx: 2, key: 'k' }, '')
    renderWithProviders({ ui: app(FALLBACK), route: '/people/7' })
    expect(screen.getByRole('button', { name: 'Back' })).toBeInTheDocument()
    expect(screen.queryByRole('link')).toBeNull()
  })
})
