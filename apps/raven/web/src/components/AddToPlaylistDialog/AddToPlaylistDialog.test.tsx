import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from 'bun:test'
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import { useToasts } from '@raven/ui'
import { AddToPlaylistDialog } from '@/components/AddToPlaylistDialog/AddToPlaylistDialog'
import { api } from '@/lib/api'
import { playlistDetails, playlistSummary, track } from '@/test/music'
import { renderWithProviders } from '@/test/render'

const AIRBAG = track({ id: 101, title: 'Airbag' })

describe('AddToPlaylistDialog', () => {
  beforeEach(() => {
    useToasts.setState({ toasts: [] })
    spyOn(api, 'listPlaylists').mockResolvedValue([
      playlistSummary(),
      playlistSummary({ id: 6, name: 'Morning', trackCount: 1, duration: 200 }),
    ])
  })

  afterEach(() => {
    cleanup()
    mock.restore()
  })

  it('lists the playlists and adds the track to the end of the one picked', async () => {
    const append = spyOn(api, 'appendPlaylistTracks').mockResolvedValue(playlistDetails())
    const closed: string[] = []
    renderWithProviders({
      ui: <AddToPlaylistDialog tracks={[AIRBAG]} onClose={() => closed.push('closed')} />,
    })
    expect(await screen.findByRole('dialog', { name: 'Add to playlist' })).toHaveTextContent(
      'Airbag',
    )
    fireEvent.click(await screen.findByRole('button', { name: /Morning/ }))
    await waitFor(() => expect(append).toHaveBeenCalledWith({ id: 6, mediaIds: [101] }))
    await waitFor(() => expect(closed).toEqual(['closed']))
    expect(useToasts.getState().toasts.map(({ message }) => message)).toEqual([
      'Added Airbag to Morning',
    ])
  })

  it('makes a new playlist by name and adds the tracks to it', async () => {
    const made = playlistDetails({
      playlist: playlistSummary({ id: 9, name: 'Road trip', trackCount: 0 }),
      tracks: [],
    })
    const create = spyOn(api, 'createPlaylist').mockResolvedValue(made)
    const append = spyOn(api, 'appendPlaylistTracks').mockResolvedValue(made)
    renderWithProviders({
      ui: <AddToPlaylistDialog tracks={[AIRBAG, track({ id: 102 })]} onClose={() => undefined} />,
    })
    await screen.findByRole('dialog', { name: 'Add to playlist' })
    expect(screen.getByText('2 tracks')).toBeTruthy()
    const make = screen.getByRole('button', { name: 'Make and add' })
    expect(make).toBeDisabled()
    fireEvent.change(screen.getByRole('textbox', { name: 'New playlist' }), {
      target: { value: ' Road trip ' },
    })
    fireEvent.click(make)
    await waitFor(() => expect(create).toHaveBeenCalledWith({ name: 'Road trip' }))
    await waitFor(() => expect(append).toHaveBeenCalledWith({ id: 9, mediaIds: [101, 102] }))
  })

  it('says so when there are no playlists yet', async () => {
    spyOn(api, 'listPlaylists').mockResolvedValue([])
    renderWithProviders({ ui: <AddToPlaylistDialog tracks={[AIRBAG]} onClose={() => undefined} /> })
    expect(await screen.findByText(/no playlists yet/)).toBeTruthy()
  })
})
