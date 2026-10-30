import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { act, cleanup, fireEvent, screen } from '@testing-library/react'
import { REPEAT_MODES } from '@raven/core'
import { AUDIO_STATES, useAudioQueue } from '@raven/ui/headless'
import { NowPlayingBar } from '@/components/NowPlayingBar/NowPlayingBar'
import { NowPlayingPage } from '@/pages/NowPlayingPage/NowPlayingPage'
import { track } from '@/test/music'
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
    expect(store().seek?.seconds).toBe(30)
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

describe('NowPlayingBar', () => {
  beforeEach(() => store().clear())
  afterEach(() => {
    cleanup()
    store().clear()
  })

  it('is gone while nothing plays, and on Now Playing itself', () => {
    const { container } = renderWithProviders({ ui: <NowPlayingBar />, route: '/' })
    expect(container).toBeEmptyDOMElement()
    store().playTracks({ tracks: TRACKS })
    cleanup()
    const onPage = renderWithProviders({ ui: <NowPlayingBar />, route: '/now-playing' })
    expect(onPage.container).toBeEmptyDOMElement()
  })

  it('names the track, drives it, and links to Now Playing', () => {
    store().playTracks({ tracks: TRACKS })
    act(() => store().engine.state(AUDIO_STATES.playing))
    renderWithProviders({ ui: <NowPlayingBar />, route: '/libraries/3' })
    const bar = screen.getByRole('region', { name: 'Now playing' })
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
