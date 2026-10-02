import { describe, expect, it, spyOn } from 'bun:test'
import { screen } from '@testing-library/react'
import { api } from '@/lib/api'
import { FavouritesPage } from '@/pages/FavouritesPage/FavouritesPage'
import { mediaItem } from '@/test/fixtures'
import { renderWithProviders } from '@/test/render'

describe('FavouritesPage', () => {
  it('lists every favourite as a card', async () => {
    const spy = spyOn(api, 'listFavourites').mockImplementation(async () => [
      mediaItem({ id: 1, title: 'First', favourite: true }),
      mediaItem({ id: 2, title: 'Second', favourite: true }),
    ])
    renderWithProviders(<FavouritesPage />)
    expect(await screen.findByRole('link', { name: 'First' })).toHaveAttribute('href', '/watch/1')
    expect(screen.getByRole('link', { name: 'Second' })).toHaveAttribute('href', '/watch/2')
    spy.mockRestore()
  })

  it('explains how to add one when there are none', async () => {
    const spy = spyOn(api, 'listFavourites').mockImplementation(async () => [])
    renderWithProviders(<FavouritesPage />)
    expect(await screen.findByText(/No favourites yet/)).toBeInTheDocument()
    spy.mockRestore()
  })
})
