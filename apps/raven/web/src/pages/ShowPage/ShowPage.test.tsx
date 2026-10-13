import { afterEach, describe, expect, it, spyOn } from 'bun:test'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route, Routes, useParams } from 'react-router-dom'
import { api } from '@/lib/api'
import { ShowPage } from '@/pages/ShowPage/ShowPage'
import { itemDetails } from '@/test/fixtures'
import { renderWithProviders } from '@/test/render'
import { EPISODE_TWO, SEVERANCE } from '@/test/tv'

const Watching = () => <p>Watching {useParams().id}</p>
const Elsewhere = () => <p>Show {useParams().id}</p>

describe('ShowPage', () => {
  const spies = {
    item: spyOn(api, 'getItem'),
    next: spyOn(api, 'nextEpisode'),
    search: spyOn(api, 'searchMatches'),
    setItemMatch: spyOn(api, 'setItemMatch'),
  }

  const open = () => {
    spies.item.mockImplementation(async () => SEVERANCE)
    spies.next.mockImplementation(async () => EPISODE_TWO)
    renderWithProviders(
      <Routes>
        <Route path="shows/:id" element={<ShowPage />} />
        <Route path="watch/:id" element={<Watching />} />
        <Route path="elsewhere/:id" element={<Elsewhere />} />
      </Routes>,
      { route: '/shows/4' },
    )
  }

  afterEach(() => {
    spies.item.mockReset()
    spies.next.mockReset()
    spies.search.mockReset()
    spies.setItemMatch.mockReset()
  })

  it('shows the creator, years, network, genres and a Play for the next episode', async () => {
    open()
    expect(await screen.findByRole('heading', { level: 1, name: 'Severance' })).toBeInTheDocument()
    expect(screen.getByText('Created by Dan Erickson')).toBeInTheDocument()
    expect(screen.getByText('2022 to now')).toBeInTheDocument()
    expect(screen.getByText('Apple TV+')).toBeInTheDocument()
    expect(screen.getByText('TV-MA')).toBeInTheDocument()
    expect(screen.queryByText('Thriller')).toBeNull()
    expect(await screen.findByRole('link', { name: 'Play S01E02' })).toHaveAttribute(
      'href',
      '/watch/13',
    )
  })

  it('opens Edit images for the show', async () => {
    const images = spyOn(api, 'getItemImages').mockImplementation(async () => ({
      poster: [],
      backdrop: [],
      logo: [],
    }))
    open()
    await userEvent.click(await screen.findByRole('button', { name: 'Edit images' }))
    expect(await screen.findByRole('heading', { name: 'Edit images' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Linked files' })).toBeNull()
    expect(images).toHaveBeenCalled()
    images.mockRestore()
  })

  it('lists the seasons on disk with their episode counts', async () => {
    open()
    const season = await screen.findByRole('link', { name: /Season 1/ })
    expect(season).toHaveAttribute('href', '/shows/4/seasons/1')
    expect(await screen.findByText('2 episodes')).toBeInTheDocument()
    expect(spies.item.mock.calls.map(([id]) => id)).toEqual([4])
  })

  it('re-points the whole show from Fix match', async () => {
    spies.search.mockImplementation(async () => [
      { tmdbId: '60622', title: 'Fargo', year: 2014, overview: null, poster: null },
    ])
    const moved: Array<{ itemId: number; tmdbId: string }> = []
    spies.setItemMatch.mockImplementation(async (request) => {
      moved.push(request)
      return itemDetails({ ...SEVERANCE, id: 9, title: 'Fargo' })
    })
    open()
    // Once the next episode is in, the page knows the show's library.
    await screen.findByRole('link', { name: 'Play S01E02' })
    await userEvent.click(await screen.findByRole('button', { name: 'Fix match' }))
    expect(screen.getByRole('searchbox', { name: 'Title' })).toHaveValue('Severance')
    expect(screen.queryByRole('button', { name: 'Not a show' })).toBeNull()
    await userEvent.click(await screen.findByRole('button', { name: 'Choose Fargo (2014)' }))
    expect(moved).toEqual([{ itemId: 4, tmdbId: '60622' }])
    expect(spies.search.mock.calls[0]?.[0]).toMatchObject({
      type: 'show',
      query: 'Severance',
      libraryId: EPISODE_TWO.libraryId,
    })
  })
})
