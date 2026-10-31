import { afterEach, describe, expect, it, mock, spyOn } from 'bun:test'
import { cleanup, screen, within } from '@testing-library/react'
import { ApiError, MIX_KINDS } from '@raven/core'
import { Route, Routes } from 'react-router-dom'
import { api } from '@/lib/api'
import { MusicHomePage } from '@/pages/MusicHomePage/MusicHomePage'
import { album, mixSummary, musicLibrary } from '@/test/music'
import { renderWithProviders } from '@/test/render'

const renderPage = (libraries = [musicLibrary()]) =>
  renderWithProviders({
    ui: (
      <Routes>
        <Route path="/music" element={<MusicHomePage />} />
      </Routes>
    ),
    route: '/music',
    libraries,
  })

const shelf = (name: string) => screen.getByRole('region', { name })

describe('MusicHomePage', () => {
  afterEach(() => {
    cleanup()
    mock.restore()
  })

  it('lists the mixes listMixes answers, then the albums played and added last', async () => {
    spyOn(api, 'listMixes').mockResolvedValue([
      mixSummary(),
      mixSummary({ id: MIX_KINDS.rediscover, trackCount: 30, duration: 6000 }),
    ])
    spyOn(api, 'getRecentAlbums').mockResolvedValue({
      played: [album({ id: 8, title: 'Kid A' })],
      added: [album({ id: 9, title: 'Amnesiac' })],
    })
    renderPage()
    const mixes = await screen.findByRole('list', { name: 'Mixes' })
    expect(within(mixes).getByRole('link', { name: 'Heavy rotation' })).toHaveAttribute(
      'href',
      '/music/mixes/heavyRotation',
    )
    expect(within(mixes).getByRole('link', { name: 'Rediscover' })).toHaveAttribute(
      'href',
      '/music/mixes/rediscover',
    )
    expect(mixes).toHaveTextContent('30 tracks · 100 min')
    expect(
      await within(shelf('Recently played')).findByRole('link', { name: 'Kid A' }),
    ).toHaveAttribute('href', '/music/albums/8')
    expect(
      within(shelf('Recently added')).getByRole('link', { name: 'Amnesiac' }),
    ).toBeInTheDocument()
  })

  it('says what each shelf lacks, and why one failed', async () => {
    spyOn(api, 'listMixes').mockResolvedValue([])
    spyOn(api, 'getRecentAlbums').mockRejectedValue(
      new ApiError({ status: 500, message: 'The server stumbled' }),
    )
    renderPage([])
    expect(
      await screen.findByText('Mixes come once raven has heard enough of your plays.'),
    ).toBeInTheDocument()
    expect(await within(shelf('Recently played')).findByRole('alert')).toHaveTextContent(
      'The server stumbled',
    )
    expect(screen.getByText('raven has no music library yet.')).toBeInTheDocument()
  })

  it('says when nothing was played or added', async () => {
    spyOn(api, 'listMixes').mockResolvedValue([])
    spyOn(api, 'getRecentAlbums').mockResolvedValue({ played: [], added: [] })
    renderPage()
    expect(
      await screen.findByText('Nothing played yet. What you play shows up here.'),
    ).toBeInTheDocument()
    expect(screen.getByText('No albums were added lately.')).toBeInTheDocument()
  })
})
