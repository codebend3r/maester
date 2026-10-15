import { describe, expect, it, spyOn } from 'bun:test'
import { screen } from '@testing-library/react'
import { mediaLabel } from '@raven/core'
import { api } from '@/lib/api'
import { POSTER_SIZES } from '@/lib/posters'
import { FavouritesPage } from '@/pages/FavouritesPage/FavouritesPage'
import { itemSummary, matchedMovie, mediaItem } from '@/test/fixtures'
import { renderWithProviders } from '@/test/render'
import { EPISODE_TWO, SEASON_ONE_CARD } from '@/test/tv'

describe('FavouritesPage', () => {
  it('lists every favourite as a card', async () => {
    const spy = spyOn(api, 'listFavourites').mockImplementation(async () => [
      { media: mediaItem({ id: 1, title: 'First', favourite: true }), poster: null },
      { media: mediaItem({ id: 2, title: 'Second', favourite: true }), poster: null },
    ])
    renderWithProviders(<FavouritesPage />)
    expect(await screen.findByRole('link', { name: 'First' })).toHaveAttribute('href', '/watch/1')
    expect(screen.getByRole('link', { name: 'Second' })).toHaveAttribute('href', '/watch/2')
    spy.mockRestore()
  })

  it("opens a matched favourite's page from its title, and plays it from its button", async () => {
    const spy = spyOn(api, 'listFavourites').mockImplementation(async () => [
      { media: matchedMovie({ favourite: true }), poster: itemSummary() },
    ])
    renderWithProviders(<FavouritesPage />)
    expect(await screen.findByRole('link', { name: 'Busboys' })).toHaveAttribute(
      'href',
      '/movies/40?library=2',
    )
    expect(screen.getByRole('link', { name: 'Play Busboys' })).toHaveAttribute('href', '/watch/7')
    spy.mockRestore()
  })

  it("shows an episode with its season's poster", async () => {
    const spy = spyOn(api, 'listFavourites').mockImplementation(async () => [
      { media: { ...EPISODE_TWO, favourite: true }, poster: SEASON_ONE_CARD },
    ])
    const { container } = renderWithProviders(<FavouritesPage />)
    expect(await screen.findByRole('link', { name: mediaLabel(EPISODE_TWO) })).toHaveAttribute(
      'href',
      '/episodes/7?library=2',
    )
    expect(container.querySelector('img')?.getAttribute('src')).toContain(
      '/api/items/5/images/poster',
    )
    expect(container.querySelector('img')).toHaveAttribute('sizes', POSTER_SIZES.grid)
    expect(container.querySelector('img')?.getAttribute('srcset')).toContain(
      '/api/items/5/images/poster?v=p5&w=185 185w',
    )
    spy.mockRestore()
  })

  it('explains how to add one when there are none', async () => {
    const spy = spyOn(api, 'listFavourites').mockImplementation(async () => [])
    renderWithProviders(<FavouritesPage />)
    expect(await screen.findByText(/No favourites yet/)).toBeInTheDocument()
    spy.mockRestore()
  })
})
