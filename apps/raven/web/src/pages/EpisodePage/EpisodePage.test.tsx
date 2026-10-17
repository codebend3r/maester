import { afterEach, describe, expect, it, spyOn } from 'bun:test'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ItemDetails } from '@raven/core'
import { Route, Routes } from 'react-router-dom'
import { api } from '@/lib/api'
import { EpisodePage } from '@/pages/EpisodePage/EpisodePage'
import { library, mediaItem } from '@/test/fixtures'
import { renderWithProviders } from '@/test/render'
import { EPISODE_ONE, EPISODE_TWO, SEASON_ONE, SEVERANCE, episodeDetails } from '@/test/tv'

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
    renderWithProviders({
      ui: (
        <Routes>
          <Route path="episodes/:id" element={<EpisodePage />} />
        </Routes>
      ),
      route,
    })
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

  it('says how much is left of an episode started, and draws the line of it', async () => {
    open()
    expect(await screen.findByText('45m left')).toBeInTheDocument()
  })

  it('leads to the episodes either side in its season, in the same library', async () => {
    spies.libraries.mockImplementation(async () => [library({ id: 2, name: 'TV' })])
    spies.tracks.mockImplementation(async () => ({
      audio: [],
      subtitles: [],
      defaultAudio: null,
      frameRate: null,
    }))
    spies.item.mockImplementation(async (id) => {
      if (id === 4) return SEVERANCE
      if (id === 5) return SEASON_ONE
      return id === 6 ? episodeDetails(EPISODE_ONE) : episodeDetails(EPISODE_TWO)
    })
    renderWithProviders({
      ui: (
        <Routes>
          <Route path="episodes/:id" element={<EpisodePage />} />
        </Routes>
      ),
      route: '/episodes/7',
    })
    const either = await screen.findByRole('navigation', { name: 'Episodes either side' })
    const previous = within(either).getByRole('link', { name: 'Previous: Good News About Hell' })
    expect(previous).toHaveAttribute('href', `/episodes/6?library=${EPISODE_TWO.libraryId}`)
    expect(within(previous).getByText('S01E01')).toBeInTheDocument()
    expect(within(either).queryByRole('link', { name: /^Next/ })).toBeNull()
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

  it('sends a media target from its Watched toggle', async () => {
    const calls: unknown[] = []
    const set = spyOn(api, 'setWatched').mockImplementation(async (input) => {
      calls.push(input)
    })
    open()
    const toggle = await screen.findByRole('button', { name: 'Watched' })
    expect(toggle).toHaveAttribute('aria-pressed', 'false')
    await userEvent.click(toggle)
    set.mockRestore()
    expect(calls).toEqual([{ watched: true, targets: [{ kind: 'media', id: EPISODE_TWO.id }] }])
  })
})
