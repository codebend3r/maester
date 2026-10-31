import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from 'bun:test'
import { act, cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import { ApiError, QUEUE_SOURCE_KINDS } from '@raven/core'
import { useToasts } from '@raven/ui'
import { useAudioQueue } from '@raven/ui/headless'
import { Route, Routes } from 'react-router-dom'
import { api } from '@/lib/api'
import { PlaylistPage } from '@/pages/PlaylistPage/PlaylistPage'
import { playlistDetails, playlistSummary, track } from '@/test/music'
import { renderWithProviders } from '@/test/render'

const PAGE = playlistDetails({
  playlist: playlistSummary({ trackCount: 3, duration: 600 }),
  tracks: [
    track({ id: 101, title: 'Airbag' }),
    track({ id: 102, title: 'Paranoid Android', number: 2 }),
    track({ id: 103, title: 'Lucky', number: 3 }),
  ],
})

const renderPage = () =>
  renderWithProviders({
    ui: (
      <Routes>
        <Route path="/playlists/:id" element={<PlaylistPage />} />
        <Route path="/" element={<p>Home page</p>} />
      </Routes>
    ),
    route: '/playlists/5',
  })

describe('PlaylistPage', () => {
  beforeEach(() => {
    useAudioQueue.getState().clear()
    spyOn(api, 'getPlaylist').mockResolvedValue(PAGE)
    spyOn(api, 'listPlaylists').mockResolvedValue([PAGE.playlist])
  })

  afterEach(() => {
    cleanup()
    mock.restore()
    useAudioQueue.getState().clear()
  })

  it('shows the playlist, its length and its tracks in order', async () => {
    renderPage()
    expect(await screen.findByRole('heading', { level: 1, name: 'Evening' })).toBeTruthy()
    expect(screen.getByText('3 tracks · 10 min')).toBeTruthy()
    const tracks = screen.getByRole('list', { name: 'Tracks' })
    expect(tracks).toHaveTextContent('Airbag')
    expect(tracks).toHaveTextContent('Lucky')
  })

  it('plays the playlist from the start, from a track, and shuffled', async () => {
    renderPage()
    await screen.findByRole('heading', { level: 1, name: 'Evening' })
    fireEvent.click(screen.getByRole('button', { name: 'Play' }))
    expect(useAudioQueue.getState().queue.items).toEqual([101, 102, 103])
    expect(useAudioQueue.getState().queue.source).toEqual({
      kind: QUEUE_SOURCE_KINDS.playlist,
      id: 5,
    })
    fireEvent.click(screen.getByRole('button', { name: 'Play Lucky' }))
    expect(useAudioQueue.getState().queue.at).toBe(2)
    fireEvent.click(screen.getByRole('button', { name: 'Shuffle' }))
    expect(useAudioQueue.getState().queue.isShuffled).toBe(true)
  })

  it('moves a track up and takes one out, sending the whole new order', async () => {
    const saved = { details: PAGE }
    spyOn(api, 'getPlaylist').mockImplementation(async () => saved.details)
    const replace = spyOn(api, 'replacePlaylistTracks').mockImplementation(async ({ mediaIds }) => {
      saved.details = {
        ...PAGE,
        tracks: mediaIds.flatMap((id) => PAGE.tracks.filter((entry) => entry.id === id)),
      }
      return saved.details
    })
    renderPage()
    await screen.findByRole('heading', { level: 1, name: 'Evening' })
    expect(screen.getByRole('button', { name: 'Move Airbag up' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Move Lucky up' }))
    await waitFor(() => expect(replace).toHaveBeenCalledWith({ id: 5, mediaIds: [101, 103, 102] }))
    const listed = () => screen.getByRole('list', { name: 'Tracks' }).textContent ?? ''
    await waitFor(() =>
      expect(listed().indexOf('Lucky')).toBeLessThan(listed().indexOf('Paranoid')),
    )
    fireEvent.click(screen.getByRole('button', { name: 'Remove Airbag from the playlist' }))
    await waitFor(() => expect(replace).toHaveBeenLastCalledWith({ id: 5, mediaIds: [103, 102] }))
  })

  it('renames the playlist from its dialog, refusing a name of only spaces', async () => {
    const renamed = { ...PAGE, playlist: { ...PAGE.playlist, name: 'Night' } }
    const rename = spyOn(api, 'renamePlaylist').mockImplementation(async () => {
      spyOn(api, 'getPlaylist').mockResolvedValue(renamed)
      return renamed
    })
    renderPage()
    await screen.findByRole('heading', { level: 1, name: 'Evening' })
    fireEvent.click(screen.getByRole('button', { name: 'Rename' }))
    const dialog = await screen.findByRole('dialog', { name: 'Rename playlist' })
    const field = screen.getByRole('textbox', { name: 'Name' })
    fireEvent.change(field, { target: { value: '   ' } })
    expect(dialog.querySelector('button[type="submit"]')).toBeDisabled()
    fireEvent.change(field, { target: { value: 'Night' } })
    fireEvent.submit(field)
    await waitFor(() => expect(rename).toHaveBeenCalledWith({ id: 5, name: 'Night' }))
    expect(await screen.findByRole('heading', { level: 1, name: 'Night' })).toBeTruthy()
  })

  it('asks before deleting, then leaves the page', async () => {
    const remove = spyOn(api, 'deletePlaylist').mockResolvedValue(undefined)
    renderPage()
    await screen.findByRole('heading', { level: 1, name: 'Evening' })
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    await screen.findByRole('dialog', { name: 'Delete Evening?' })
    fireEvent.click(screen.getByRole('button', { name: 'Delete playlist' }))
    await waitFor(() => expect(remove).toHaveBeenCalledWith(5))
    expect(await screen.findByText('Home page')).toBeTruthy()
  })

  it('leaves before the server answers, and says so in a toast when it refuses', async () => {
    const answer = Promise.withResolvers<undefined>()
    spyOn(api, 'deletePlaylist').mockImplementation(() => answer.promise)
    useToasts.setState({ toasts: [] })
    renderPage()
    await screen.findByRole('heading', { level: 1, name: 'Evening' })
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    await screen.findByRole('dialog', { name: 'Delete Evening?' })
    fireEvent.click(screen.getByRole('button', { name: 'Delete playlist' }))
    expect(await screen.findByText('Home page')).toBeTruthy()
    await act(async () => answer.reject(new Error('Server is down')))
    await waitFor(() =>
      expect(useToasts.getState().toasts.map(({ message }) => message)).toEqual([
        'Could not delete Evening: Server is down',
      ]),
    )
  })

  it('says so when the playlist is empty', async () => {
    spyOn(api, 'getPlaylist').mockResolvedValue(
      playlistDetails({ playlist: playlistSummary({ trackCount: 0, duration: 0 }), tracks: [] }),
    )
    renderPage()
    expect(await screen.findByText(/Nothing in Evening yet/)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Play' })).toBeDisabled()
  })

  it('says when there is no such playlist', async () => {
    spyOn(api, 'getPlaylist').mockRejectedValue(
      new ApiError({ status: 404, message: 'No playlist 5' }),
    )
    renderPage()
    expect(await screen.findByText('Nothing lives at this address')).toBeTruthy()
  })
})
