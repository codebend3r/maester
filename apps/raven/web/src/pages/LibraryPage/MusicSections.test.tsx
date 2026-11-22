import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from 'bun:test'
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import {
  LIBRARY_KINDS,
  MATCH_FACTS,
  MUSIC_LIST_PARAMS,
  MUSIC_SORTS,
  SORT_DIRECTIONS,
} from '@raven/core'
import { useToasts } from '@raven/ui'
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

  it('opens albums as covers with newest releases first', async () => {
    renderWithProviders({ ui: <AlbumsSection library={MUSIC} />, route: '/libraries/3' })
    expect(await screen.findByRole('link', { name: 'OK Computer' })).toHaveAttribute(
      'href',
      '/albums/7',
    )
    expect(screen.getByRole('link', { name: 'Kid A' })).toBeTruthy()
    expect(screen.getByRole('combobox', { name: 'Sort' })).toHaveValue(MUSIC_SORTS.release)
    expect(screen.getByRole('button', { name: 'Reverse sort order' })).toHaveTextContent(
      'Descending',
    )
    expect(screen.getAllByText('2000').length).toBeGreaterThan(0)
    expect(api.listAlbums).toHaveBeenCalledWith({
      libraryId: 3,
      search: '',
      sort: MUSIC_SORTS.release,
      order: SORT_DIRECTIONS.descending,
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

  it('starts an AI smart match for the admin and says so in a toast', async () => {
    spyOn(api, 'listAlbums').mockResolvedValue([
      album({ id: 9, title: 'Zooropa', sortTitle: 'Zooropa', match: 'unmatched' }),
    ])
    const smartMatch = spyOn(api, 'smartMatchAlbums').mockResolvedValue({ albums: 1 })
    renderWithProviders({
      ui: <UnmatchedAlbumsSection library={MUSIC} />,
      route: '/libraries/3/unmatched-albums',
    })
    fireEvent.click(await screen.findByRole('button', { name: 'AI smart match' }))
    await waitFor(() => expect(smartMatch).toHaveBeenCalledWith(3))
    await waitFor(() =>
      expect(useToasts.getState().toasts.map(({ message }) => message)).toEqual([
        'Smart match started on 1 unmatched album. Each result shows here as it lands, and stays in Notifications.',
      ]),
    )
  })
})

describe('UnmatchedAlbumsSection on hover', () => {
  afterEach(() => {
    cleanup()
    mock.restore()
  })

  it('says over the cover how close the nearest release came, each fact, and Claude’s summary, asking once', async () => {
    spyOn(api, 'listAlbums').mockResolvedValue([
      album({ id: 9, title: 'B.C.', sortTitle: 'B.C.', year: 2008, match: 'unmatched' }),
    ])
    const diagnose = spyOn(api, 'getAlbumMatchDiagnosis').mockResolvedValue({
      closest: {
        mbid: '11111111-1111-4111-8111-000000000001',
        title: '2000 B.C.',
        artist: 'Canibus',
        year: 2000,
        trackCount: 15,
        type: 'album',
        country: 'US',
        confidence: 70,
      },
      facts: [
        { fact: MATCH_FACTS.title, points: 35, most: 45, album: 'B.C.', release: '2000 B.C.' },
        { fact: MATCH_FACTS.artist, points: 30, most: 30, album: 'Canibus', release: 'Canibus' },
        { fact: MATCH_FACTS.year, points: 0, most: 10, album: '2008', release: '2000' },
        { fact: MATCH_FACTS.trackCount, points: 0, most: 10, album: '14', release: '15' },
        { fact: MATCH_FACTS.official, points: 5, most: 5, album: null, release: null },
      ],
      reason: 'Year is 2008; MusicBrainz says 2000.',
      fix: 'Set the year to 2000.',
    })
    renderWithProviders({
      ui: <UnmatchedAlbumsSection library={MUSIC} />,
      route: '/libraries/3/unmatched-albums',
    })
    const title = await screen.findByRole('link', { name: 'B.C.' })
    const card = title.closest('li')
    expect(screen.queryByRole('tooltip')).toBeNull()
    expect(diagnose).not.toHaveBeenCalled()
    fireEvent.pointerEnter(card ?? title)
    const hint = await screen.findByRole('tooltip')
    expect(await screen.findByText('Closest match: 70 of 100, 80 needed')).toBeTruthy()
    expect(hint).toHaveTextContent('2000 B.C. by Canibus, 2000')
    expect(hint).toHaveTextContent('Yours: 2008. MusicBrainz: 2000.')
    expect(hint).toHaveTextContent('An official release')
    expect(hint).toHaveTextContent('Smart match says: Year is 2008; MusicBrainz says 2000.')
    expect(hint).toHaveTextContent('How to fix')
    expect(hint).toHaveTextContent('Set the year to 2000.')
    expect(title).toHaveAttribute('aria-describedby', hint.id)
    fireEvent.pointerLeave(card ?? title)
    expect(screen.queryByRole('tooltip')).toBeNull()
    fireEvent.pointerEnter(card ?? title)
    await screen.findByText('Closest match: 70 of 100, 80 needed')
    expect(diagnose).toHaveBeenCalledTimes(1)
    expect(diagnose).toHaveBeenCalledWith(9)
  })
})

describe('UnmatchedAlbumsSection on hover with no word from smart match', () => {
  afterEach(() => {
    cleanup()
    mock.restore()
  })

  it('reads the fix off the first fact that differs, or says what to check when nothing was found', async () => {
    spyOn(api, 'listAlbums').mockResolvedValue([
      album({ id: 9, title: 'B.C.', sortTitle: 'B.C.', match: 'unmatched' }),
      album({ id: 10, title: 'Lulu', sortTitle: 'Lulu', match: 'unmatched' }),
    ])
    spyOn(api, 'getAlbumMatchDiagnosis').mockImplementation(async (albumId) =>
      albumId === 9
        ? {
            closest: {
              mbid: '11111111-1111-4111-8111-000000000001',
              title: '2000 B.C.',
              artist: 'Canibus',
              year: 2000,
              trackCount: 15,
              type: 'album',
              country: null,
              confidence: 70,
            },
            facts: [
              {
                fact: MATCH_FACTS.title,
                points: 35,
                most: 45,
                album: 'B.C.',
                release: '2000 B.C.',
              },
              { fact: MATCH_FACTS.year, points: 0, most: 10, album: '2008', release: '2000' },
            ],
            reason: null,
            fix: null,
          }
        : { closest: null, facts: [], reason: null, fix: null },
    )
    renderWithProviders({
      ui: <UnmatchedAlbumsSection library={MUSIC} />,
      route: '/libraries/3/unmatched-albums',
    })
    const bc = await screen.findByRole('link', { name: 'B.C.' })
    fireEvent.pointerEnter(bc.closest('li') ?? bc)
    await screen.findByText('Rename the title to “2000 B.C.”.')
    expect(screen.getByRole('tooltip')).not.toHaveTextContent('Smart match says')
    fireEvent.pointerLeave(bc.closest('li') ?? bc)
    const lulu = screen.getByRole('link', { name: 'Lulu' })
    fireEvent.pointerEnter(lulu.closest('li') ?? lulu)
    await screen.findByText('Check the title and artist tags, or use Fix match.')
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
    expect(screen.getByText('Loading artists')).toBeInTheDocument()
  })

  it('shows a failed artist request', async () => {
    spyOn(api, 'listArtists').mockRejectedValue(new Error('Artists unavailable'))
    renderWithProviders({ ui: <ArtistsSection library={MUSIC} />, route: '/libraries/3/artists' })
    expect(await screen.findByRole('alert')).toHaveTextContent('Artists unavailable')
  })
})
