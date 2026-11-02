import { afterEach, describe, expect, it, spyOn } from 'bun:test'
import { act, cleanup, fireEvent, screen } from '@testing-library/react'
import { AUDIO_STATES, useAudioQueue } from '@raven/ui/headless'
import { NowPlayingBar } from '@/components/NowPlayingBar/NowPlayingBar'
import { NOW_PLAYING_BAR_COPY } from '@/components/NowPlayingBar/copy'
import equalizer from '@/components/Equalizer/Equalizer.module.scss'
import { renderWithProviders } from '@/test/render'
import { track } from '@/test/music'

afterEach(() => {
  cleanup()
  useAudioQueue.getState().clear()
})

describe('mini-player', () => {
  it('closes and empties the queue so neither the current nor next track plays', () => {
    useAudioQueue.getState().playTracks({ tracks: [track(), track({ id: 102 })] })
    renderWithProviders({ ui: <NowPlayingBar /> })
    fireEvent.click(screen.getByRole('button', { name: NOW_PLAYING_BAR_COPY.close }))
    expect(screen.queryByRole('region', { name: NOW_PLAYING_BAR_COPY.miniPlayer })).toBeNull()
    expect(useAudioQueue.getState().state).toBe(AUDIO_STATES.empty)
    expect(useAudioQueue.getState().queue.items).toEqual([])
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
    const timeline = screen.getByRole('slider')
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
    expect(screen.getByRole('slider').hasAttribute('disabled')).toBe(true)
  })

  it('animates the equalizer while audio plays and holds it still when paused', () => {
    useAudioQueue.getState().playTracks({ tracks: [track()] })
    const { container } = renderWithProviders({ ui: <NowPlayingBar /> })
    expect(container.querySelector(`.${equalizer.still}`)).not.toBeNull()
    act(() => useAudioQueue.getState().engine.state(AUDIO_STATES.playing))
    expect(container.querySelector(`.${equalizer.still}`)).toBeNull()
    act(() => useAudioQueue.getState().pause())
    expect(container.querySelector(`.${equalizer.still}`)).not.toBeNull()
  })
})
