import { describe, expect, it } from 'bun:test'
import { screen, within } from '@testing-library/react'
import { Route, Routes } from 'react-router-dom'
import { AppShell } from '@/components/AppShell/AppShell'
import { renderWithProviders } from '@/test/render'

describe('AppShell', () => {
  it('links to the libraries and the favourites, marking the current page', () => {
    renderWithProviders(
      <Routes>
        <Route element={<AppShell />}>
          <Route index element={<p>home</p>} />
          <Route path="favourites" element={<p>favourites</p>} />
        </Route>
      </Routes>,
      { route: '/favourites' },
    )
    const nav = screen.getByRole('navigation', { name: 'Main' })
    expect(within(nav).getByRole('link', { name: 'Libraries' })).toHaveAttribute('href', '/')
    const favourites = within(nav).getByRole('link', { name: 'Favourites' })
    expect(favourites).toHaveAttribute('href', '/favourites')
    expect(favourites).toHaveAttribute('aria-current', 'page')
    expect(within(nav).getByRole('link', { name: 'Libraries' })).not.toHaveAttribute('aria-current')
  })
})
