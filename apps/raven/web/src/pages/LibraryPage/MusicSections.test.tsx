import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from 'bun:test'
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import { LIBRARY_KINDS, MUSIC_LIST_PARAMS, MUSIC_SORTS, SORT_DIRECTIONS } from '@raven/core'
import { useAudioQueue } from '@raven/ui/headless'
import { api } from '@/lib/api'
import {
  AlbumsSection,
  ArtistsSection,
  UnmatchedAlbumsSection,
} from '@/pages/LibraryPage/MusicSections'
import { library } from '@/test/fixtures'
import { album, artist, track } from '@/test/music'
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

  it('jumps by title letter when listed by title', async () => {
    renderWithProviders({
      ui: <AlbumsSection library={MUSIC} />,
      route: `/libraries/3?${MUSIC_LIST_PARAMS.sort}=${MUSIC_SORTS.title}`,
    })
    await screen.findByRole('link', { name: 'OK Computer' })
    expect(screen.getByRole('button', { name: 'O' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'R' })).toBeDisabled()
  })

  it('has no jump strip when listed at random', async () => {
    renderWithProviders({
      ui: <AlbumsSection library={MUSIC} />,
      route: `/libraries/3?${MUSIC_LIST_PARAMS.sort}=${MUSIC_SORTS.random}`,
    })
    await screen.findByRole('link', { name: 'OK Computer' })
    expect(screen.queryByRole('navigation', { name: /Jump to/ })).toBeNull()
  })

  it('lists the albums as covers with their artists and years', async () => {
    renderWithProviders({ ui: <AlbumsSection library={MUSIC} />, route: '/libraries/3' })
    expect(await screen.findByRole('link', { name: 'OK Computer' })).toHaveAttribute(
      'href',
      '/albums/7',
    )
    expect(screen.getByRole('link', { name: 'Kid A' })).toBeTruthy()
    expect(screen.getByRole('navigation', { name: 'Jump to a letter' })).toBeTruthy()
    // Listed by artist, so the strip is the artists' letters, not the titles'.
    expect(screen.getByRole('button', { name: 'R' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'O' })).toBeDisabled()
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

describe('UnmatchedAlbumsSection', () => {
  afterEach(() => {
    cleanup()
    mock.restore()
  })

  it('lists unmatched albums only and offers the alphabet jump strip', async () => {
    spyOn(api, 'listAlbums').mockResolvedValue([
      album({ id: 9, title: 'Zooropa', sortTitle: 'Zooropa', match: 'unmatched' }),
      album({ id: 10, title: 'The Bends', sortTitle: 'Bends', match: 'matched' }),
    ])
    renderWithProviders({
      ui: <UnmatchedAlbumsSection library={MUSIC} />,
      route: '/libraries/3/unmatched-albums',
    })
    expect(await screen.findByRole('link', { name: 'Zooropa' })).toHaveAttribute(
      'href',
      '/albums/9',
    )
    expect(screen.queryByRole('link', { name: 'The Bends' })).toBeNull()
    const picker = screen.getByRole('navigation', { name: 'Jump to a letter' })
    expect(screen.getByRole('button', { name: 'Z' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'O' })).toBeDisabled()
    expect(picker).toBeTruthy()
  })
})

describe('ArtistsSection', () => {
  beforeEach(() => {
    spyOn(api, 'listArtists').mockResolvedValue([
      artist(),
      artist({ id: 2, name: 'Blur', albumCount: 2, trackCount: 1 }),
      artist({ id: 3, name: 'Featured guest', albumCount: 0, trackCount: 1 }),
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
    expect(list).not.toHaveTextContent('Featured guest')
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
