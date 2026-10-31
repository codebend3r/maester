import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from 'bun:test'
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { Route, Routes } from 'react-router-dom'
import { LIBRARY_KINDS } from '@raven/core'
import { useAudioQueue } from '@raven/ui/headless'
import { api } from '@/lib/api'
import { AlbumsSection, ArtistsSection, PlaylistsSection } from '@/pages/LibraryPage/MusicSections'
import { library } from '@/test/fixtures'
import { album, artist, playlistDetails, playlistSummary, track } from '@/test/music'
import { renderWithProviders } from '@/test/render'

const MUSIC = library({
  id: 3,
  name: 'Music',
  settings: { ...library().settings, kind: LIBRARY_KINDS.music },
})

describe('AlbumsSection', () => {
  beforeEach(() => {
    useAudioQueue.getState().clear()
    spyOn(api, 'listAlbums').mockResolvedValue([
      album(),
      album({ id: 8, title: 'Kid A', year: 2000, coverVersion: null }),
    ])
    spyOn(api, 'listTracks').mockResolvedValue({
      tracks: [track(), track({ id: 102, title: 'Paranoid Android', number: 2 })],
      total: 2,
    })
  })

  afterEach(() => {
    cleanup()
    mock.restore()
    useAudioQueue.getState().clear()
  })

  it('lists the albums as covers with their artists and years', async () => {
    renderWithProviders({ ui: <AlbumsSection library={MUSIC} />, route: '/libraries/3' })
    expect(await screen.findByRole('link', { name: 'OK Computer' })).toHaveAttribute(
      'href',
      '/albums/7',
    )
    expect(screen.getByRole('link', { name: 'Kid A' })).toBeTruthy()
    expect(screen.getByText('· 2000')).toBeTruthy()
    expect(api.listAlbums).toHaveBeenCalledWith({ libraryId: 3, search: '', sort: 'artist' })
  })

  it('sorts as asked, and plays the library’s tracks in that order', async () => {
    renderWithProviders({ ui: <AlbumsSection library={MUSIC} />, route: '/libraries/3' })
    await screen.findByRole('link', { name: 'OK Computer' })
    fireEvent.change(screen.getByRole('combobox', { name: 'Sort' }), { target: { value: 'year' } })
    await waitFor(() =>
      expect(api.listAlbums).toHaveBeenCalledWith({ libraryId: 3, search: '', sort: 'year' }),
    )
    fireEvent.click(screen.getByRole('button', { name: 'Play' }))
    await waitFor(() => expect(useAudioQueue.getState().queue.items).toEqual([101, 102]))
    expect(useAudioQueue.getState().queue.source).toEqual({ kind: 'library', id: 3 })
    expect(api.listTracks).toHaveBeenCalledWith({
      libraryId: 3,
      search: '',
      sort: 'year',
      limit: 500,
    })
    expect(useAudioQueue.getState().queue.isShuffled).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: 'Shuffle' }))
    await waitFor(() => expect(useAudioQueue.getState().queue.isShuffled).toBe(true))
  })

  it('says when the library has no albums, and when nothing matches a search', async () => {
    spyOn(api, 'listAlbums').mockResolvedValue([])
    renderWithProviders({ ui: <AlbumsSection library={MUSIC} />, route: '/libraries/3' })
    expect(await screen.findByText(/No albums in Music yet/)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Play' })).toBeDisabled()
  })
})

describe('ArtistsSection', () => {
  beforeEach(() => {
    spyOn(api, 'listArtists').mockResolvedValue([
      artist(),
      artist({ id: 2, name: 'Blur', albumCount: 2, trackCount: 1 }),
    ])
  })

  afterEach(() => {
    cleanup()
    mock.restore()
    useAudioQueue.getState().clear()
  })

  it('lists the artists with their counts, each linking to their page', async () => {
    renderWithProviders({ ui: <ArtistsSection library={MUSIC} />, route: '/libraries/3/artists' })
    expect(await screen.findByRole('link', { name: 'Radiohead' })).toHaveAttribute(
      'href',
      '/artists/1',
    )
    const list = screen.getByRole('list', { name: 'Artists' })
    expect(list).toHaveTextContent('1 album · 2 tracks')
    expect(list).toHaveTextContent('2 albums · 1 track')
  })
})

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
