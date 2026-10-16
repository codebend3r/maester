import { afterEach, describe, expect, it, spyOn } from 'bun:test'
import { cleanup, screen } from '@testing-library/react'
import type { ItemDetails } from '@raven/core'
import { Route, Routes } from 'react-router-dom'
import { api } from '@/lib/api'
import { EpisodePage } from '@/pages/EpisodePage/EpisodePage'
import { library, mediaItem } from '@/test/fixtures'
import { renderWithProviders } from '@/test/render'
import { EPISODE_TWO, episodeDetails } from '@/test/tv'

describe('EpisodePage', () => {
  const spies = {
    item: spyOn(api, 'getItem'),
    libraries: spyOn(api, 'listLibraries'),
    tracks: spyOn(api, 'getTracks'),
  }

  afterEach(() => {
    cleanup()
    spies.item.mockReset()
    spies.libraries.mockReset()
    spies.tracks.mockReset()
  })

  const open = ({
    details = episodeDetails(EPISODE_TWO),
    route = '/episodes/7',
  }: { details?: ItemDetails; route?: string } = {}) => {
    spies.item.mockImplementation(async () => details)
    spies.libraries.mockImplementation(async () => [
      library({ id: 2, name: 'TV' }),
      library({ id: 3, name: '4K TV' }),
    ])
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
      { route },
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

  it("plays the file of the library the address names, never another library's", async () => {
    const uhd = mediaItem({ ...EPISODE_TWO, id: 14, libraryId: 3, position: 0 })
    open({
      details: { ...episodeDetails(EPISODE_TWO), versions: [EPISODE_TWO, uhd] },
      route: '/episodes/7?library=3',
    })
    expect(await screen.findByRole('link', { name: 'Play' })).toHaveAttribute('href', '/watch/14')
    expect(screen.queryByRole('heading', { name: 'Versions' })).toBeNull()
  })
})
