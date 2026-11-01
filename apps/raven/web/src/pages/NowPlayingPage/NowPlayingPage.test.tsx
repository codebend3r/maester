import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from 'bun:test'
import { act, cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import { LIBRARY_KINDS, REPEAT_MODES, LYRICS_KINDS, LYRICS_SOURCES } from '@raven/core'
import { AUDIO_STATES, useAudioQueue, usePlayerPrefs } from '@raven/ui/headless'
import { api } from '@/lib/api'
import { NowPlayingBar } from '@/components/NowPlayingBar/NowPlayingBar'
import { NowPlayingPage } from '@/pages/NowPlayingPage/NowPlayingPage'
import { library } from '@/test/fixtures'
import { playlistDetails, playlistSummary, track } from '@/test/music'
import { renderWithProviders } from '@/test/render'

const store = () => useAudioQueue.getState()

const TRACKS = [
  track({ id: 101, title: 'Airbag' }),
  track({ id: 102, title: 'Paranoid Android', number: 2 }),
  track({ id: 103, title: 'Subterranean Homesick Alien', number: 3 }),
]

describe('NowPlayingPage', () => {
  beforeEach(() => store().clear())
  afterEach(() => {
    cleanup()
    store().clear()
  })

  it('says when nothing plays', () => {
    renderWithProviders({ ui: <NowPlayingPage />, route: '/now-playing' })
    expect(screen.getByText(/Nothing is playing/)).toBeTruthy()
  })

  it('shows the playing track, drives it, and lists the queue', () => {
    store().playTracks({ tracks: TRACKS })
    act(() => store().engine.state(AUDIO_STATES.playing))
    act(() => store().engine.time({ position: 61, duration: 200 }))
    renderWithProviders({ ui: <NowPlayingPage />, route: '/now-playing' })
    expect(screen.getByRole('heading', { level: 2, name: 'Airbag' })).toBeTruthy()
    expect(screen.getByRole('link', { name: 'OK Computer' })).toHaveAttribute('href', '/albums/7')
    expect(screen.getByText('1:01')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Pause' }))
    expect(store().state).toBe(AUDIO_STATES.paused)
    fireEvent.click(screen.getByRole('button', { name: 'Next track' }))
    expect(store().queue.at).toBe(1)
    fireEvent.change(screen.getByRole('slider', { name: 'Position' }), { target: { value: '30' } })
    expect(store().seek?.seconds ?? null).toBe(30)
    fireEvent.click(screen.getByRole('button', { name: 'Repeat off' }))
    expect(store().queue.repeat).toBe(REPEAT_MODES.all)
    fireEvent.click(screen.getByRole('button', { name: 'Shuffle off' }))
    expect(store().queue.isShuffled).toBe(true)
    const queue = screen.getByRole('list', { name: 'Queue' })
    expect(queue).toHaveTextContent('Subterranean Homesick Alien')
  })

  it('removes, moves and clears from the queue', () => {
    store().playTracks({ tracks: TRACKS })
    renderWithProviders({ ui: <NowPlayingPage />, route: '/now-playing' })
    const [, second] = screen.getAllByRole('button', { name: 'Move up' })
    if (!second) throw new Error('No second row')
    fireEvent.click(second)
    expect(store().queue.order).toEqual([1, 0, 2])
    fireEvent.click(screen.getAllByRole('button', { name: 'Remove from queue' })[2] ?? second)
    expect(store().queue.items).toHaveLength(2)
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }))
    expect(store().state).toBe(AUDIO_STATES.empty)
    expect(screen.getByText(/Nothing is playing/)).toBeTruthy()
  })
})

const BOOKS = library({
  id: 4,
  name: 'Audiobooks',
  settings: { ...library().settings, kind: LIBRARY_KINDS.audiobooks },
})
const MUSIC = library({
  id: 3,
  name: 'Music',
  settings: { ...library().settings, kind: LIBRARY_KINDS.music },
})

const BOOK = track({ id: 201, libraryId: 4, title: 'The Hobbit', duration: 3000 })

describe('NowPlayingPage lyrics', () => {
  beforeEach(() => store().clear())
  afterEach(() => {
    cleanup()
    mock.restore()
    store().clear()
  })

  it('marks the synced line being sung, and follows the clock', async () => {
    spyOn(api, 'getLyrics').mockResolvedValue({
      kind: LYRICS_KINDS.synced,
      source: LYRICS_SOURCES.lrclib,
      lines: [
        { at: 10, text: 'In the next world war' },
        { at: 14, text: 'In a jackknifed juggernaut' },
      ],
    })
    store().playTracks({ tracks: TRACKS })
    act(() => store().engine.time({ position: 11, duration: 200 }))
    renderWithProviders({ ui: <NowPlayingPage />, route: '/now-playing', libraries: [MUSIC] })
    const sung = await screen.findByText('In the next world war')
    expect(sung).toHaveAttribute('aria-current', 'true')
    act(() => store().engine.time({ position: 15, duration: 200 }))
    expect(sung).not.toHaveAttribute('aria-current')
    expect(screen.getByText('In a jackknifed juggernaut')).toHaveAttribute('aria-current', 'true')
  })

  it('shows plain lyrics as text, and says quietly when there are none', async () => {
    spyOn(api, 'getLyrics').mockImplementation(async (id) =>
      id === 101
        ? { kind: LYRICS_KINDS.plain, source: LYRICS_SOURCES.tags, text: 'Airbag words' }
        : { kind: LYRICS_KINDS.none },
    )
    store().playTracks({ tracks: TRACKS })
    renderWithProviders({ ui: <NowPlayingPage />, route: '/now-playing', libraries: [MUSIC] })
    expect(await screen.findByRole('region', { name: 'Lyrics' })).toHaveTextContent('Airbag words')
    act(() => store().next())
    expect(await screen.findByText('No lyrics for this track.')).toBeTruthy()
  })

  it('adds the playing track to a playlist', async () => {
    spyOn(api, 'getLyrics').mockResolvedValue({ kind: LYRICS_KINDS.none })
    spyOn(api, 'listPlaylists').mockResolvedValue([playlistSummary()])
    const append = spyOn(api, 'appendPlaylistTracks').mockResolvedValue(playlistDetails())
    store().playTracks({ tracks: TRACKS })
    renderWithProviders({ ui: <NowPlayingPage />, route: '/now-playing', libraries: [MUSIC] })
    fireEvent.click(screen.getByRole('button', { name: 'Add to playlist' }))
    fireEvent.click(await screen.findByRole('button', { name: /Evening/ }))
    await waitFor(() => expect(append).toHaveBeenCalledWith({ id: 5, mediaIds: [101] }))
  })
})

describe('NowPlayingPage for an audiobook', () => {
  beforeEach(() => {
    store().clear()
    spyOn(api, 'getMarkers').mockResolvedValue({
      intro: { kind: 'intro', start: 0, end: 30, source: 'chapter', confidence: 1 },
      credits: null,
      chapters: [
        { start: 0, end: 30, title: 'Opening' },
        { start: 30, end: 900, title: 'An Unexpected Party' },
        { start: 900, end: 3000, title: null },
      ],
    })
  })
  afterEach(() => {
    cleanup()
    mock.restore()
    store().clear()
    usePlayerPrefs.getState().setAudiobookSpeed(1)
  })

  it('lists the chapters with the current one marked, and never offers Skip intro', async () => {
    const lyrics = spyOn(api, 'getLyrics')
    store().playTracks({ tracks: [BOOK] })
    act(() => store().engine.time({ position: 100, duration: 3000 }))
    renderWithProviders({ ui: <NowPlayingPage />, route: '/now-playing', libraries: [BOOKS] })
    const chapters = await screen.findByRole('list', { name: 'Chapters' })
    expect(chapters).toHaveTextContent('Opening')
    expect(chapters).toHaveTextContent('Chapter 3')
    expect(screen.getByRole('button', { name: /An Unexpected Party/ })).toHaveAttribute(
      'aria-current',
      'true',
    )
    expect(screen.queryByRole('button', { name: /skip intro/i })).toBeNull()
    expect(screen.queryByRole('heading', { name: 'Lyrics' })).toBeNull()
    expect(lyrics).not.toHaveBeenCalled()
  })

  it('skips between chapters and plays from a chapter picked', async () => {
    store().playTracks({ tracks: [BOOK] })
    act(() => store().engine.time({ position: 100, duration: 3000 }))
    renderWithProviders({ ui: <NowPlayingPage />, route: '/now-playing', libraries: [BOOKS] })
    await screen.findByRole('list', { name: 'Chapters' })
    fireEvent.click(screen.getByRole('button', { name: 'Next chapter' }))
    expect(store().seek?.seconds ?? null).toBe(900)
    fireEvent.click(screen.getByRole('button', { name: 'Previous chapter' }))
    expect(store().seek?.seconds ?? null).toBe(30)
    fireEvent.click(screen.getByRole('button', { name: /Opening/ }))
    expect(store().seek?.seconds ?? null).toBe(0)
  })

  it('reads at the speed picked, which music never offers', async () => {
    store().playTracks({ tracks: [BOOK] })
    renderWithProviders({ ui: <NowPlayingPage />, route: '/now-playing', libraries: [BOOKS] })
    const speed = await screen.findByRole('combobox', { name: 'Speed' })
    fireEvent.change(speed, { target: { value: '1.5' } })
    expect(usePlayerPrefs.getState().audiobookSpeed).toBe(1.5)
    cleanup()
    spyOn(api, 'getLyrics').mockResolvedValue({ kind: LYRICS_KINDS.none })
    store().playTracks({ tracks: TRACKS })
    renderWithProviders({ ui: <NowPlayingPage />, route: '/now-playing', libraries: [MUSIC] })
    await screen.findByText('No lyrics for this track.')
    expect(screen.queryByRole('combobox', { name: 'Speed' })).toBeNull()
  })
})

describe('NowPlayingBar', () => {
  beforeEach(() => store().clear())
  afterEach(() => {
    cleanup()
    store().clear()
  })

  it('is gone while nothing plays, and on Now Playing itself', () => {
    const { container } = renderWithProviders({ ui: <NowPlayingBar />, route: '/' })
    expect(container).toBeEmptyDOMElement()
    act(() => store().playTracks({ tracks: TRACKS }))
    cleanup()
    const onPage = renderWithProviders({ ui: <NowPlayingBar />, route: '/now-playing' })
    expect(onPage.container).toBeEmptyDOMElement()
  })

  it('names the track, drives it, and links to Now Playing', () => {
    store().playTracks({ tracks: TRACKS })
    act(() => store().engine.state(AUDIO_STATES.playing))
    renderWithProviders({ ui: <NowPlayingBar />, route: '/libraries/3' })
    const bar = screen.getByRole('region', { name: 'Mini-player' })
    expect(bar).toHaveTextContent('Airbag')
    expect(bar).toHaveTextContent('Radiohead')
    expect(screen.getAllByRole('link', { name: 'Now playing' })[0]).toHaveAttribute(
      'href',
      '/now-playing',
    )
    fireEvent.click(screen.getByRole('button', { name: 'Pause' }))
    expect(store().state).toBe(AUDIO_STATES.paused)
    fireEvent.click(screen.getByRole('button', { name: 'Next track' }))
    expect(store().queue.at).toBe(1)
    fireEvent.click(screen.getByRole('button', { name: 'Previous track' }))
    expect(store().queue.at).toBe(0)
    act(() => store().engine.failed('The connection to the server dropped.'))
    expect(bar).toHaveTextContent('The connection to the server dropped.')
  })
})
