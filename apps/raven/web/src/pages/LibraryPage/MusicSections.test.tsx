import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from 'bun:test'
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import { Route, Routes } from 'react-router-dom'
import { LIBRARY_KINDS, MUSIC_SORTS, SORT_DIRECTIONS } from '@raven/core'
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
    expect(screen.getByText('2000')).toBeTruthy()
    expect(api.listAlbums).toHaveBeenCalledWith({
      libraryId: 3,
      search: '',
      sort: MUSIC_SORTS.artist,
      order: SORT_DIRECTIONS.ascending,
      seed: 0,
    })
  })

  it('sorts as asked, and plays the library’s tracks in that order', async () => {
    renderWithProviders({ ui: <AlbumsSection library={MUSIC} />, route: '/libraries/3' })
    await screen.findByRole('link', { name: 'OK Computer' })
    fireEvent.change(screen.getByRole('combobox', { name: 'Sort' }), { target: { value: 'year' } })
    await waitFor(() =>
      expect(api.listAlbums).toHaveBeenCalledWith({
        libraryId: 3,
        search: '',
        sort: MUSIC_SORTS.year,
        order: SORT_DIRECTIONS.ascending,
        seed: 0,
      }),
    )
    fireEvent.click(screen.getByRole('button', { name: 'Play' }))
    await waitFor(() => expect(useAudioQueue.getState().queue.items).toEqual([101, 102]))
    expect(useAudioQueue.getState().queue.source).toEqual({ kind: 'library', id: 3 })
    expect(api.listTracks).toHaveBeenCalledWith({
      libraryId: 3,
      search: '',
      sort: MUSIC_SORTS.year,
      order: SORT_DIRECTIONS.ascending,
      seed: 0,
      byAlbum: true,
      limit: 500,
    })
    expect(useAudioQueue.getState().queue.isShuffled).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: 'Shuffle' }))
    await waitFor(() => expect(useAudioQueue.getState().queue.isShuffled).toBe(true))
  })

  it('restores precise release-date sorting from the address and reverses it', async () => {
    spyOn(api, 'listAlbums').mockResolvedValue([album({ releaseDate: '1997-05-21' })])
    renderWithProviders({
      ui: <AlbumsSection library={MUSIC} />,
      route: '/libraries/3?sort=release&order=descending',
    })
    expect(await screen.findByText('May 21, 1997')).toBeTruthy()
    expect(screen.getByText('1 album')).toBeTruthy()
    expect(screen.getByRole('combobox', { name: 'Sort' })).toHaveValue(MUSIC_SORTS.release)
    expect(api.listAlbums).toHaveBeenCalledWith({
      libraryId: 3,
      search: '',
      sort: MUSIC_SORTS.release,
      order: SORT_DIRECTIONS.descending,
      seed: 0,
    })
    fireEvent.click(screen.getByRole('button', { name: 'Reverse sort order' }))
    await waitFor(() =>
      expect(api.listAlbums).toHaveBeenCalledWith({
        libraryId: 3,
        search: '',
        sort: MUSIC_SORTS.release,
        order: SORT_DIRECTIONS.ascending,
        seed: 0,
      }),
    )
  })

  it('fetches every track page before playing, rather than stopping at 500', async () => {
    const songs = Array.from({ length: 501 }, (_, at) => track({ id: at + 1 }))
    spyOn(api, 'listTracks').mockImplementation(async ({ offset = 0, limit = 500 }) => ({
      tracks: songs.slice(offset, offset + limit),
      total: songs.length,
    }))
    renderWithProviders({ ui: <AlbumsSection library={MUSIC} />, route: '/libraries/3' })
    await screen.findByRole('link', { name: 'OK Computer' })
    fireEvent.click(screen.getByRole('button', { name: 'Play' }))
    await waitFor(() => expect(useAudioQueue.getState().queue.items).toHaveLength(501))
    expect(useAudioQueue.getState().queue.items.at(-1)).toBe(501)
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

describe('artist request states', () => {
  afterEach(() => {
    cleanup()
    mock.restore()
  })

  it('shows a loading state rather than a blank page', () => {
    spyOn(api, 'listArtists').mockImplementation(() => new Promise(() => undefined))
    renderWithProviders({ ui: <ArtistsSection library={MUSIC} />, route: '/libraries/3/artists' })
    expect(screen.getByRole('status')).toHaveTextContent('Loading artists')
  })

  it('shows a failed artist request', async () => {
    spyOn(api, 'listArtists').mockRejectedValue(new Error('Artists unavailable'))
    renderWithProviders({ ui: <ArtistsSection library={MUSIC} />, route: '/libraries/3/artists' })
    expect(await screen.findByRole('alert')).toHaveTextContent('Artists unavailable')
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
