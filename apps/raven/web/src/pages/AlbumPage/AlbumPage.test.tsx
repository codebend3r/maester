import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from 'bun:test'
import { act, cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import { type AlbumDetails, ApiError } from '@raven/core'
import { AUDIO_STATES, useAudioQueue, usePlayerPrefs } from '@raven/ui/headless'
import { Route, Routes } from 'react-router-dom'
import { api } from '@/lib/api'
import { ravenPlayer } from '@/lib/ravenPlayer'
import { AlbumPage } from '@/pages/AlbumPage/AlbumPage'
import { library } from '@/test/fixtures'
import {
  albumDetails,
  albumMatchCandidate,
  playlistDetails,
  playlistSummary,
  track,
} from '@/test/music'
import { renderWithProviders } from '@/test/render'

const renderPage = () =>
  renderWithProviders({
    ui: (
      <Routes>
        <Route path="/albums/:id" element={<AlbumPage />} />
      </Routes>
    ),
    route: '/albums/7',
    libraries: [library({ id: 3, name: 'Music' })],
  })

describe('AlbumPage', () => {
  beforeEach(() => {
    useAudioQueue.getState().clear()
    spyOn(api, 'getAlbum').mockResolvedValue(albumDetails())
    spyOn(api, 'getLibrary').mockResolvedValue(library({ id: 3, name: 'Music' }))
  })

  afterEach(() => {
    cleanup()
    mock.restore()
    useAudioQueue.getState().clear()
  })

  it('shows the album, its artists and facts, and its tracks', async () => {
    renderPage()
    expect(await screen.findByRole('heading', { level: 1, name: 'OK Computer' })).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Radiohead' })).toHaveAttribute('href', '/artists/1')
    expect(screen.getByText('1997 · Album · 2 tracks · 7 min')).toBeTruthy()
    expect(screen.getByText('Parlophone')).toBeTruthy()
    const tracks = screen.getByRole('list', { name: 'Tracks' })
    expect(tracks).toHaveTextContent('Airbag')
    expect(tracks).toHaveTextContent('Paranoid Android')
    expect(tracks).toHaveTextContent('3:20')
  })

  it('plays the album from the start, from a track, and queues it next or at the end', async () => {
    renderPage()
    await screen.findByRole('heading', { level: 1, name: 'OK Computer' })
    fireEvent.click(screen.getByRole('button', { name: 'Play' }))
    expect(useAudioQueue.getState().queue.items).toEqual([101, 102])
    expect(useAudioQueue.getState().queue.source).toEqual({ kind: 'album', id: 7 })
    expect(useAudioQueue.getState().state).toBe(AUDIO_STATES.loading)
    fireEvent.click(screen.getByRole('button', { name: 'Play Paranoid Android' }))
    expect(useAudioQueue.getState().queue.at).toBe(1)
    act(() => useAudioQueue.getState().engine.state(AUDIO_STATES.playing))
    expect(screen.getByRole('button', { name: 'Pause Paranoid Android' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Add to queue' }))
    expect(useAudioQueue.getState().queue.items).toHaveLength(4)
    fireEvent.click(screen.getByRole('button', { name: 'Play next' }))
    expect(useAudioQueue.getState().queue.order.slice(2, 4)).toEqual([4, 5])
  })

  it('lists the discs apart, naming each track’s artists when they differ', async () => {
    spyOn(api, 'getAlbum').mockResolvedValue(
      albumDetails({
        discCount: 2,
        tracks: [
          track({ id: 101, disc: 1 }),
          track({ id: 102, disc: 2, title: 'Guest', artists: [{ id: 9, name: 'Someone' }] }),
        ],
      }),
    )
    renderPage()
    await screen.findByRole('heading', { level: 1, name: 'OK Computer' })
    expect(screen.getByRole('heading', { level: 2, name: 'Disc 2' })).toBeTruthy()
    expect(screen.getByRole('list', { name: 'Disc 2 tracks' })).toHaveTextContent('Someone')
    fireEvent.click(screen.getByRole('button', { name: 'Play Guest' }))
    expect(useAudioQueue.getState().queue.at).toBe(1)
  })

  it('offers Fix match to whoever may manage, and points the album at the pick', async () => {
    spyOn(api, 'searchAlbumMatches').mockResolvedValue([albumMatchCandidate()])
    const setMatch = spyOn(api, 'setAlbumMatch').mockResolvedValue(albumDetails())
    renderPage()
    await screen.findByRole('heading', { level: 1, name: 'OK Computer' })
    fireEvent.click(screen.getByRole('button', { name: 'Fix match' }))
    const dialog = await screen.findByRole('dialog', { name: 'Fix match' })
    expect(dialog).toHaveTextContent('Best match')
    fireEvent.click(await screen.findByRole('button', { name: 'Choose OK Computer by Radiohead' }))
    await waitFor(() =>
      expect(setMatch).toHaveBeenCalledWith({
        albumId: 7,
        mbid: '11111111-1111-4111-8111-000000000002',
      }),
    )
  })

  it('marks the album a favourite before the server answers', async () => {
    const answer = Promise.withResolvers<AlbumDetails>()
    const mark = spyOn(api, 'setAlbumFavourite').mockImplementation(() => answer.promise)
    renderPage()
    await screen.findByRole('heading', { level: 1, name: 'OK Computer' })
    const heart = screen.getByRole('button', { name: 'Favourite' })
    expect(heart).toHaveAttribute('aria-pressed', 'false')
    fireEvent.click(heart)
    await waitFor(() => expect(heart).toHaveAttribute('aria-pressed', 'true'))
    expect(mark).toHaveBeenCalledWith({ albumId: 7, favourite: true })
    answer.resolve(albumDetails({ isFavourite: true }))
  })

  it('adds a track, or the whole album, to a playlist', async () => {
    spyOn(api, 'listPlaylists').mockResolvedValue([playlistSummary()])
    const append = spyOn(api, 'appendPlaylistTracks').mockResolvedValue(playlistDetails())
    renderPage()
    await screen.findByRole('heading', { level: 1, name: 'OK Computer' })
    fireEvent.click(screen.getByRole('button', { name: 'Add Paranoid Android to a playlist' }))
    fireEvent.click(await screen.findByRole('button', { name: /Evening/ }))
    await waitFor(() => expect(append).toHaveBeenCalledWith({ id: 5, mediaIds: [102] }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    fireEvent.click(screen.getByRole('button', { name: 'Add to playlist' }))
    fireEvent.click(await screen.findByRole('button', { name: /Evening/ }))
    await waitFor(() => expect(append).toHaveBeenLastCalledWith({ id: 5, mediaIds: [101, 102] }))
  })

  it('says when there is no such album', async () => {
    spyOn(api, 'getAlbum').mockRejectedValue(new ApiError({ status: 404, message: 'No album 7' }))
    renderPage()
    expect(await screen.findByText(/album/i)).toBeTruthy()
  })

  it('hands the album to Raven to download', async () => {
    const handoff = spyOn(ravenPlayer, 'open').mockImplementation(() => {})
    usePlayerPrefs.setState({ opensInRavenPlayer: true })
    try {
      renderPage()
      fireEvent.click(await screen.findByRole('button', { name: 'Download to Raven' }))
      expect(handoff).toHaveBeenCalledWith(
        `raven://download?server=${encodeURIComponent(window.location.origin)}&album=7`,
      )
    } finally {
      cleanup()
      usePlayerPrefs.setState({ opensInRavenPlayer: false })
    }
  })
})
