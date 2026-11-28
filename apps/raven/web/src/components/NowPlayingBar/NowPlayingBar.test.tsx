import { afterEach, describe, expect, it, jest, spyOn } from 'bun:test'
import { act, cleanup, fireEvent, screen, within } from '@testing-library/react'
import { LIBRARY_KINDS } from '@raven/core'
import { EQUALIZER_MARK, SOUND_BAR_LEVEL } from '@raven/ui'
import {
  AUDIO_STATES,
  MUSIC_QUALITIES,
  useAudioQueue,
  usePlayerPrefs,
  useSoundMeter,
} from '@raven/ui/headless'
import { NowPlayingBar } from '@/components/NowPlayingBar/NowPlayingBar'
import { NOW_PLAYING_BAR_COPY } from '@/components/NowPlayingBar/copy'
import { PANE_COPY } from '@/lib/nowPlayingPanes'
import { library } from '@/test/fixtures'
import { renderWithProviders } from '@/test/render'
import { track } from '@/test/music'

const MUSIC = library({
  id: track().libraryId,
  name: 'Music',
  settings: { ...library().settings, kind: LIBRARY_KINDS.music },
})

afterEach(() => {
  cleanup()
  jest.restoreAllMocks()
  useSoundMeter.setState({ levels: null })
  useAudioQueue.getState().clear()
  usePlayerPrefs.getState().setMusicQuality(MUSIC_QUALITIES.original)
})

describe('mini-player', () => {
  it('opens Now Playing on the queue or the lyrics, and never stops the music itself', () => {
    useAudioQueue.getState().playTracks({ tracks: [track(), track({ id: 102 })] })
    renderWithProviders({ ui: <NowPlayingBar /> })
    const bar = within(screen.getByRole('region', { name: NOW_PLAYING_BAR_COPY.miniPlayer }))
    expect(bar.getByRole('link', { name: PANE_COPY.upNext })).toHaveAttribute(
      'href',
      '/now-playing?show=queue',
    )
    expect(bar.getByRole('link', { name: PANE_COPY.lyrics })).toHaveAttribute(
      'href',
      '/now-playing?show=extras',
    )
    expect(bar.queryByRole('button', { name: /close|stop/iu })).toBeNull()
  })

  it('sets the volume every player shares, and mutes it', () => {
    usePlayerPrefs.getState().setVolume({ volume: 1, muted: false })
    useAudioQueue.getState().playTracks({ tracks: [track()] })
    renderWithProviders({ ui: <NowPlayingBar /> })
    fireEvent.change(screen.getByRole('slider', { name: 'Volume' }), { target: { value: '40' } })
    expect(usePlayerPrefs.getState().volume).toBe(0.4)
    fireEvent.click(screen.getByRole('button', { name: 'Mute' }))
    expect(usePlayerPrefs.getState().muted).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Unmute' }))
    expect(usePlayerPrefs.getState().muted).toBe(false)
  })

  it('shows the current time and track length', () => {
    useAudioQueue.getState().playTracks({ tracks: [track({ duration: 245 })] })
    useAudioQueue.getState().engine.time({ position: 63, duration: 245 })
    renderWithProviders({ ui: <NowPlayingBar /> })
    expect(screen.getByText('1:03 / 4:05')).toBeTruthy()
  })

  it.each([AUDIO_STATES.playing, AUDIO_STATES.paused])(
    'seeks from the timeline without changing the %s state',
    (state) => {
      useAudioQueue.getState().playTracks({ tracks: [track({ duration: 240 })] })
      useAudioQueue.getState().engine.state(AUDIO_STATES.playing)
      if (state === AUDIO_STATES.paused) useAudioQueue.getState().pause()
      renderWithProviders({ ui: <NowPlayingBar /> })
      const timeline = screen.getByRole('slider', { name: NOW_PLAYING_BAR_COPY.position })
      fireEvent.change(timeline, { target: { value: '90' } })
      expect(useAudioQueue.getState().position).toBe(90)
      expect(useAudioQueue.getState().seek?.seconds).toBe(90)
      expect(useAudioQueue.getState().state).toBe(state)
      expect(useAudioQueue.getState().shouldPlay).toBe(state === AUDIO_STATES.playing)
      expect(timeline.getAttribute('aria-valuetext')).toBe('1:30 / 4:00')
      if (state === AUDIO_STATES.paused) {
        fireEvent.click(screen.getByRole('button', { name: 'Play' }))
        expect(useAudioQueue.getState().shouldPlay).toBe(true)
        expect(useAudioQueue.getState().position).toBe(90)
      }
    },
  )

  it('previews the timestamp under the pointer without seeking and hides it on leave', () => {
    useAudioQueue.getState().playTracks({ tracks: [track({ duration: 240 })] })
    renderWithProviders({ ui: <NowPlayingBar /> })
    const timeline = screen.getByRole('slider', { name: NOW_PLAYING_BAR_COPY.position })
    const bounds = spyOn(timeline, 'getBoundingClientRect').mockReturnValue({
      left: 100,
      right: 500,
      top: 0,
      bottom: 42,
      width: 400,
      height: 42,
      x: 100,
      y: 0,
      toJSON: () => ({}),
    })
    fireEvent.mouseMove(timeline, { clientX: 200 })
    expect(screen.getByText('1:00')).toBeTruthy()
    fireEvent.mouseMove(timeline, { clientX: 400 })
    expect(screen.getByText('3:00')).toBeTruthy()
    expect(useAudioQueue.getState().position).toBe(0)
    expect(useAudioQueue.getState().seek).toBeNull()
    fireEvent.mouseLeave(timeline)
    expect(screen.queryByText('3:00')).toBeNull()
    bounds.mockRestore()
  })

  it('disables seeking until the track length is known', () => {
    useAudioQueue.getState().playTracks({ tracks: [track({ duration: null })] })
    renderWithProviders({ ui: <NowPlayingBar /> })
    expect(
      screen.getByRole('slider', { name: NOW_PLAYING_BAR_COPY.position }).hasAttribute('disabled'),
    ).toBe(true)
  })

  it('shows the equalizer, following the sound while audio plays and holding it when paused', () => {
    const frames: FrameRequestCallback[] = []
    spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      frames.push(callback)
      return frames.length
    })
    spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {
      frames.length = 0
    })
    useSoundMeter.getState().claim(({ count }) => Array.from({ length: count }, () => 1))
    useAudioQueue.getState().playTracks({ tracks: [track()] })
    const { container } = renderWithProviders({ ui: <NowPlayingBar /> })
    const bars = () =>
      Array.from(container.querySelectorAll(`[${EQUALIZER_MARK}] > span`)).map((bar) =>
        bar instanceof HTMLElement ? bar.style.getPropertyValue(SOUND_BAR_LEVEL) : '',
      )
    act(() => useAudioQueue.getState().engine.state(AUDIO_STATES.paused))
    expect(frames).toHaveLength(0)
    expect(bars()).toEqual(['', '', '', '', ''])
    act(() => useAudioQueue.getState().engine.state(AUDIO_STATES.playing))
    act(() => frames.shift()?.(0))
    expect(bars()).toEqual(['1', '1', '1', '1', '1'])
    act(() => useAudioQueue.getState().pause())
    expect(frames).toHaveLength(0)
    expect(bars()).toEqual(['1', '1', '1', '1', '1'])
  })

  it('says the format and quality the track plays in, beside the queue and the volume', async () => {
    useAudioQueue.getState().playTracks({ tracks: [track()] })
    renderWithProviders({ ui: <NowPlayingBar />, libraries: [MUSIC] })
    const bar = within(screen.getByRole('region', { name: NOW_PLAYING_BAR_COPY.miniPlayer }))
    const line = await bar.findByText('Quality, FLAC, 16-bit, 44.1 kHz, 900 kbps')
    expect(line.parentElement?.parentElement).toBe(
      bar.getByRole('link', { name: PANE_COPY.upNext }).parentElement,
    )
  })

  it('says the transcode when the prefs ask for one, and nothing before the libraries are read', async () => {
    usePlayerPrefs.getState().setMusicQuality(MUSIC_QUALITIES.standard)
    useAudioQueue.getState().playTracks({ tracks: [track()] })
    renderWithProviders({ ui: <NowPlayingBar /> })
    expect(screen.queryByText(/^Quality/u)).toBeNull()
    cleanup()
    renderWithProviders({ ui: <NowPlayingBar />, libraries: [MUSIC] })
    expect(await screen.findByText('Quality, AAC, 256 kbps')).toBeTruthy()
  })
})
