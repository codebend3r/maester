import { afterEach, describe, expect, it, mock, spyOn } from 'bun:test'
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { Route, Routes } from 'react-router-dom'
import { PlaylistsSection } from '@/components/PlaylistsSection/PlaylistsSection'
import { api } from '@/lib/api'
import { playlistDetails, playlistSummary } from '@/test/music'
import { renderWithProviders } from '@/test/render'

describe('PlaylistsSection', () => {
  afterEach(() => {
    cleanup()
    mock.restore()
  })

  it("lists the account's playlists with their length, each linking to its page", async () => {
    spyOn(api, 'listPlaylists').mockResolvedValue([playlistSummary()])
    renderWithProviders({ ui: <PlaylistsSection />, route: '/libraries/3/playlists' })
    expect(await screen.findByRole('link', { name: 'Evening' })).toHaveAttribute(
      'href',
      '/playlists/5',
    )
    expect(screen.getByText('2 tracks · 7 min')).toBeTruthy()
  })

  it("groups other accounts' shared playlists under Shared with you", async () => {
    spyOn(api, 'listPlaylists').mockResolvedValue([
      playlistSummary(),
      playlistSummary({ id: 8, name: 'Their mix', isOwn: false, isShared: true }),
    ])
    renderWithProviders({ ui: <PlaylistsSection />, route: '/libraries/3/playlists' })
    const shared = await screen.findByRole('list', { name: 'Shared with you' })
    expect(within(shared).getByRole('link', { name: 'Their mix' })).toHaveAttribute(
      'href',
      '/playlists/8',
    )
    expect(within(shared).queryByRole('link', { name: 'Evening' })).toBeNull()
    const own = screen.getByRole('list', { name: 'Playlists' })
    expect(within(own).queryByRole('link', { name: 'Their mix' })).toBeNull()
  })

  it('leaves Shared with you out while nobody shares one', async () => {
    spyOn(api, 'listPlaylists').mockResolvedValue([playlistSummary()])
    renderWithProviders({ ui: <PlaylistsSection />, route: '/libraries/3/playlists' })
    await screen.findByRole('link', { name: 'Evening' })
    expect(screen.queryByRole('list', { name: 'Shared with you' })).toBeNull()
  })

  it('makes a playlist by name and opens it', async () => {
    spyOn(api, 'listPlaylists').mockResolvedValue([])
    const create = spyOn(api, 'createPlaylist').mockResolvedValue(
      playlistDetails({ playlist: playlistSummary({ id: 9, name: 'Road trip' }), tracks: [] }),
    )
    renderWithProviders({
      ui: (
        <Routes>
          <Route path="/libraries/3/playlists" element={<PlaylistsSection />} />
          <Route path="/playlists/9" element={<p>Road trip page</p>} />
        </Routes>
      ),
      route: '/libraries/3/playlists',
    })
    expect(await screen.findByText(/No playlists yet/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'New playlist' }))
    await screen.findByRole('dialog', { name: 'New playlist' })
    fireEvent.change(screen.getByRole('textbox', { name: 'Name' }), {
      target: { value: 'Road trip' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Make playlist' }))
    await waitFor(() => expect(create).toHaveBeenCalledWith({ name: 'Road trip' }))
    expect(await screen.findByText('Road trip page')).toBeTruthy()
  })
})
