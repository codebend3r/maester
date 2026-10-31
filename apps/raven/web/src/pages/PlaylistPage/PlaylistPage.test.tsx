import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from 'bun:test'
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import { ApiError, type PlaylistDetails, QUEUE_SOURCE_KINDS } from '@raven/core'
import { useAudioQueue, usePlayerPrefs } from '@raven/ui/headless'
import { Route, Routes } from 'react-router-dom'
import { api } from '@/lib/api'
import { ravenPlayer } from '@/lib/ravenPlayer'
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

const THEIRS = playlistDetails({
  playlist: playlistSummary({ id: 8, name: 'Their mix', isOwn: false, isShared: true }),
  tracks: PAGE.tracks,
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

type RenderTheirsProps = { copied?: PlaylistDetails }

/** Another account's shared playlist, open on its page, and `copied`, its copy, once made. */
const renderTheirs = ({ copied }: RenderTheirsProps = {}) => {
  spyOn(api, 'getPlaylist').mockImplementation(async (id) =>
    id === copied?.playlist.id ? copied : THEIRS,
  )
  return renderWithProviders({
    ui: (
      <Routes>
        <Route path="/playlists/:id" element={<PlaylistPage />} />
      </Routes>
    ),
    route: '/playlists/8',
  })
}

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

  it('hands the playlist to Raven to download', async () => {
    const handoff = spyOn(ravenPlayer, 'open').mockImplementation(() => {})
    usePlayerPrefs.setState({ opensInRavenPlayer: true })
    try {
      renderPage()
      fireEvent.click(await screen.findByRole('button', { name: 'Download to Raven' }))
      expect(handoff).toHaveBeenCalledWith(
        `raven://download?server=${encodeURIComponent(window.location.origin)}&playlist=5`,
      )
    } finally {
      cleanup()
      usePlayerPrefs.setState({ opensInRavenPlayer: false })
    }
  })

  it('shares the playlist with every account from its Shared switch', async () => {
    const share = spyOn(api, 'setPlaylistSharing').mockResolvedValue({
      ...PAGE,
      playlist: { ...PAGE.playlist, isShared: true },
    })
    renderPage()
    const shared = await screen.findByRole('switch', { name: 'Shared' })
    expect(shared).not.toBeChecked()
    fireEvent.click(shared)
    await waitFor(() => expect(share).toHaveBeenCalledWith({ id: 5, isShared: true }))
    await waitFor(() => expect(screen.getByRole('switch', { name: 'Shared' })).toBeChecked())
  })

  it("shows another's playlist with no rename, delete, reorder or remove", async () => {
    renderTheirs()
    await screen.findByRole('heading', { level: 1, name: 'Their mix' })
    expect(screen.queryByRole('button', { name: 'Rename' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Delete' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Move Lucky up' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Remove Airbag from the playlist' })).toBeNull()
    expect(screen.queryByRole('switch', { name: 'Shared' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Play' })).toBeEnabled()
  })

  it("copies another's playlist into the account's own and opens the copy", async () => {
    const copied = playlistDetails({
      playlist: playlistSummary({ id: 12, name: 'Their mix' }),
      tracks: PAGE.tracks,
    })
    const copy = spyOn(api, 'copyPlaylist').mockResolvedValue(copied)
    renderTheirs({ copied })
    fireEvent.click(await screen.findByRole('button', { name: 'Copy to my playlists' }))
    await waitFor(() => expect(copy).toHaveBeenCalledWith({ id: 8 }))
    expect(await screen.findByRole('button', { name: 'Rename' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Copy to my playlists' })).toBeNull()
  })

  it("says why another's playlist could not be copied", async () => {
    spyOn(api, 'copyPlaylist').mockRejectedValue(
      new ApiError({ status: 404, message: 'No playlist 8' }),
    )
    renderTheirs()
    fireEvent.click(await screen.findByRole('button', { name: 'Copy to my playlists' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Could not change the playlist: No playlist 8',
    )
  })
})
