import { afterEach, describe, expect, it } from 'bun:test'
import { act, cleanup, fireEvent, screen } from '@testing-library/react'
import { AUDIO_STATES, useAudioQueue } from '@raven/ui/headless'
import { NowPlayingBar } from '@/components/NowPlayingBar/NowPlayingBar'
import { NOW_PLAYING_BAR_COPY } from '@/components/NowPlayingBar/copy'
import styles from '@/components/NowPlayingBar/NowPlayingBar.module.scss'
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

  it('shows the equalizer only while audio is actually playing', () => {
    useAudioQueue.getState().playTracks({ tracks: [track()] })
    const { container } = renderWithProviders({ ui: <NowPlayingBar /> })
    expect(container.querySelector(`.${styles.equalizer}`)).toBeNull()
    act(() => useAudioQueue.getState().engine.state(AUDIO_STATES.playing))
    expect(container.querySelector(`.${styles.equalizer}`)).not.toBeNull()
    act(() => useAudioQueue.getState().pause())
    expect(container.querySelector(`.${styles.equalizer}`)).toBeNull()
  })
})
