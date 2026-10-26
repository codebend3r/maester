import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { type PosterEntry, mediaLabel } from '@raven/core'
import { useLocation } from 'react-router-dom'
import { api } from '@/lib/api'
import { POSTER_SIZES } from '@/lib/posters'
import { FavouritesPage } from '@/pages/FavouritesPage/FavouritesPage'
import { itemSummary, matchedMovie, mediaItem } from '@/test/fixtures'
import { renderWithProviders } from '@/test/render'
import { EPISODE_TWO, SEASON_ONE_CARD } from '@/test/tv'

describe('FavouritesPage', () => {
  const titles = spyOn(api, 'listFavouriteTitles')
  beforeEach(() => {
    titles.mockImplementation(async () => [])
  })
  afterEach(() => {
    titles.mockReset()
  })

  it('lists every favourite as a card', async () => {
    const spy = spyOn(api, 'listFavourites').mockImplementation(async () => [
      { media: mediaItem({ id: 1, title: 'First', favourite: true }), poster: null },
      { media: mediaItem({ id: 2, title: 'Second', favourite: true }), poster: null },
    ])
    renderWithProviders({ ui: <FavouritesPage /> })
    expect(await screen.findByRole('link', { name: 'First' })).toHaveAttribute('href', '/watch/1')
    expect(screen.getByRole('link', { name: 'Second' })).toHaveAttribute('href', '/watch/2')
    spy.mockRestore()
  })

  it("opens a matched favourite's page from its title, and plays it from its button", async () => {
    const spy = spyOn(api, 'listFavourites').mockImplementation(async () => [
      { media: matchedMovie({ favourite: true }), poster: itemSummary() },
    ])
    renderWithProviders({ ui: <FavouritesPage /> })
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
    const { container } = renderWithProviders({ ui: <FavouritesPage /> })
    expect(await screen.findByRole('link', { name: mediaLabel(EPISODE_TWO) })).toHaveAttribute(
      'href',
      '/episodes/7?library=2',
    )
    expect(container.querySelector('img')?.getAttribute('src')).toContain(
      '/api/pictures/items/5/poster',
    )
    expect(container.querySelector('img')).toHaveAttribute('sizes', POSTER_SIZES.grid)
    expect(container.querySelector('img')?.getAttribute('srcset')).toContain(
      '/api/pictures/items/5/poster/p5?w=185 185w',
    )
    spy.mockRestore()
  })

  it('lists favourite shows and seasons before the videos, each opening its page', async () => {
    titles.mockImplementation(async () => [
      itemSummary({ id: 90, type: 'show', title: 'Severance', year: 2022 }),
      SEASON_ONE_CARD,
    ])
    const spy = spyOn(api, 'listFavourites').mockImplementation(async () => [
      { media: matchedMovie({ favourite: true }), poster: itemSummary() },
    ])
    renderWithProviders({ ui: <FavouritesPage /> })
    expect(await screen.findByRole('link', { name: /^Severance/ })).toHaveAttribute(
      'href',
      '/shows/90',
    )
    expect(screen.getByText('3 favourites')).toBeInTheDocument()
    const pills = within(screen.getByRole('group', { name: 'Show' }))
      .getAllByRole('button')
      .map((pill) => pill.textContent)
    expect(pills).toEqual(['All', 'Shows', 'Seasons', 'Movies'])
    await userEvent.click(screen.getByRole('button', { name: 'Shows' }))
    expect(screen.getByText('1 favourite')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Busboys' })).toBeNull()
    spy.mockRestore()
  })

  it('explains how to add one when there are none', async () => {
    const spy = spyOn(api, 'listFavourites').mockImplementation(async () => [])
    renderWithProviders({ ui: <FavouritesPage /> })
    expect(await screen.findByText(/No favourites yet/)).toBeInTheDocument()
    spy.mockRestore()
  })

  describe('the kind filter', () => {
    const MOVIE: PosterEntry = {
      media: matchedMovie({ id: 1, favourite: true }),
      poster: itemSummary(),
    }
    const EPISODE: PosterEntry = {
      media: { ...EPISODE_TWO, favourite: true },
      poster: SEASON_ONE_CARD,
    }
    const HOME_VIDEO: PosterEntry = {
      media: mediaItem({ id: 3, title: 'Birthday', favourite: true }),
      poster: null,
    }

    /** Where the page's address stands, so a test can see what rides in it. */
    const Address = () => <output data-testid="address">{useLocation().search}</output>

    type ServeProps = {
      entries: PosterEntry[]
      route?: string
    }

    const serve = ({ entries, route = '/favourites' }: ServeProps) => {
      const spy = spyOn(api, 'listFavourites').mockImplementation(async () => entries)
      renderWithProviders({
        ui: (
          <>
            <FavouritesPage />
            <Address />
          </>
        ),
        route,
      })
      return spy
    }

    it('offers each kind among the favourites, and narrows to the one picked', async () => {
      const spy = serve({ entries: [MOVIE, EPISODE, HOME_VIDEO] })
      expect(await screen.findByRole('link', { name: 'Busboys' })).toBeInTheDocument()
      expect(screen.getByText('3 favourites')).toBeInTheDocument()
      const pills = within(screen.getByRole('group', { name: 'Show' }))
        .getAllByRole('button')
        .map((pill) => pill.textContent)
      expect(pills).toEqual(['All', 'Movies', 'Episodes', 'Other videos'])
      expect(screen.getByRole('button', { name: 'All' })).toHaveAttribute('aria-pressed', 'true')

      await userEvent.click(screen.getByRole('button', { name: 'Episodes' }))
      expect(screen.getByRole('button', { name: 'Episodes' })).toHaveAttribute(
        'aria-pressed',
        'true',
      )
      expect(screen.getByRole('link', { name: mediaLabel(EPISODE_TWO) })).toBeInTheDocument()
      expect(screen.queryByRole('link', { name: 'Busboys' })).toBeNull()
      expect(screen.queryByRole('link', { name: 'Birthday' })).toBeNull()
      expect(screen.getByText('1 favourite')).toBeInTheDocument()
      expect(screen.getByTestId('address')).toHaveTextContent('?kind=episodes')

      await userEvent.click(screen.getByRole('button', { name: 'Other videos' }))
      expect(screen.getByRole('link', { name: 'Birthday' })).toBeInTheDocument()
      expect(screen.queryByRole('link', { name: mediaLabel(EPISODE_TWO) })).toBeNull()

      await userEvent.click(screen.getByRole('button', { name: 'All' }))
      expect(screen.getByRole('link', { name: 'Busboys' })).toBeInTheDocument()
      expect(screen.getByTestId('address')).toBeEmptyDOMElement()
      spy.mockRestore()
    })

    it('starts on the kind the address names', async () => {
      const spy = serve({ entries: [MOVIE, EPISODE], route: '/favourites?kind=movies' })
      expect(await screen.findByRole('link', { name: 'Busboys' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Movies' })).toHaveAttribute('aria-pressed', 'true')
      expect(screen.queryByRole('link', { name: mediaLabel(EPISODE_TWO) })).toBeNull()
      spy.mockRestore()
    })

    it('shows them all when the address names a kind there are none of, or none at all', async () => {
      const spy = serve({ entries: [MOVIE, EPISODE], route: '/favourites?kind=other' })
      expect(await screen.findByRole('link', { name: 'Busboys' })).toBeInTheDocument()
      expect(screen.getByRole('link', { name: mediaLabel(EPISODE_TWO) })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'All' })).toHaveAttribute('aria-pressed', 'true')
      spy.mockRestore()
    })

    it('has nothing to filter while every favourite is of one kind', async () => {
      const spy = serve({
        entries: [MOVIE, { ...MOVIE, media: { ...MOVIE.media, id: 2 } }],
        route: '/favourites?kind=episodes',
      })
      expect(await screen.findAllByRole('link', { name: 'Busboys' })).toHaveLength(2)
      expect(screen.queryByRole('group', { name: 'Show' })).toBeNull()
      spy.mockRestore()
    })
  })
})
