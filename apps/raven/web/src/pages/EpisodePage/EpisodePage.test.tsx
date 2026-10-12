import { afterEach, describe, expect, it, spyOn } from 'bun:test'
import { screen } from '@testing-library/react'
import { Route, Routes } from 'react-router-dom'
import { api } from '@/lib/api'
import { EpisodePage } from '@/pages/EpisodePage/EpisodePage'
import { library } from '@/test/fixtures'
import { renderWithProviders } from '@/test/render'
import { EPISODE_TWO, episodeDetails } from '@/test/tv'

describe('EpisodePage', () => {
  const spies = {
    item: spyOn(api, 'getItem'),
    libraries: spyOn(api, 'listLibraries'),
    tracks: spyOn(api, 'getTracks'),
  }

  afterEach(() => {
    spies.item.mockReset()
    spies.libraries.mockReset()
    spies.tracks.mockReset()
  })

  const open = () => {
    spies.item.mockImplementation(async () => episodeDetails(EPISODE_TWO))
    spies.libraries.mockImplementation(async () => [library({ id: 2, name: 'TV' })])
    spies.tracks.mockImplementation(async () => ({
      audio: [],
      subtitles: [],
      defaultAudio: null,
      frameRate: null,
    }))
    renderWithProviders(
      <Routes>
        <Route path="episodes/:id" element={<EpisodePage />} />
      </Routes>,
      { route: '/episodes/7' },
    )
  }

  it('shows the show and number, the title, air date, summary, guests and Resume', async () => {
    open()
    expect(await screen.findByRole('heading', { level: 1, name: 'Half Loop' })).toBeInTheDocument()
    expect(screen.getByText('Severance · Season 1 · Episode 2')).toBeInTheDocument()
    expect(screen.getByText(/18 Feb 2022|Feb 18, 2022/)).toBeInTheDocument()
    expect(screen.getByText('Half Loop is an episode.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Resume from 10:00' })).toHaveAttribute(
      'href',
      '/watch/13',
    )
    expect(screen.getByRole('heading', { name: 'Guest stars & crew' })).toBeInTheDocument()
    expect(screen.getByText('Mr. Milchick')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Severance' })).toHaveAttribute(
      'href',
      '/shows/4/seasons/1',
    )
  })

  it('plays from its still', async () => {
    open()
    const still = await screen.findByRole('link', { name: 'Play Half Loop' })
    expect(still).toHaveAttribute('href', '/watch/13')
    expect(still.querySelector('img')).not.toBeNull()
  })
})
