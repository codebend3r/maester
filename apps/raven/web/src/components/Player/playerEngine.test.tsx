import { describe, expect, it, mock, spyOn } from 'bun:test'
import { act, fireEvent, renderHook, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { type ReactNode, useEffect } from 'react'
import { Player } from '@/components/Player/Player'
import { PlayerServicesProvider, type PlayerServices } from '@/components/Player/PlayerServices'
import { PlayerChrome } from '@/components/Player/Stage'
import type { EngineActions, EngineHandle } from '@/components/Player/engine'
import type { TrackSelection } from '@/components/Player/useTrackSelection'
import { useHtmlEngine } from '@/components/Player/useHtmlEngine'
import { initialVideoState, videoReducer } from '@/components/Player/useVideoState'
import { useWatchProgress } from '@/components/Player/useWatchProgress'
import { api } from '@/lib/api'
import { renderWithProviders } from '@/test/render'

const servicesFor = (): PlayerServices => ({
  title: { label: 'Local clip', duration: 120, resumeAt: 20, backTo: '/', next: null },
  progress: { started: mock(() => {}), save: mock(() => {}), left: mock(() => {}) },
  posterUrl: null,
  escape: null,
})

const selection: TrackSelection = {
  tracks: null,
  tracksFailed: false,
  tracksPending: false,
  audio: null,
  isDefaultAudio: true,
  subtitle: null,
  isWaitingForTracks: false,
  pickAudio: () => {},
  pickSubtitle: () => {},
}

const actionsFor = (): EngineActions => ({
  play: mock(() => {}),
  pause: mock(() => {}),
  seek: mock(() => {}),
  setVolume: mock(() => {}),
  setRate: mock(() => {}),
  setAudio: mock(() => {}),
  setSubtitle: mock(() => {}),
  setSubtitleScale: mock(() => {}),
})

describe('videoReducer ended', () => {
  it('clears ended when playback restarts or seeks, not on ordinary clock updates', () => {
    const ended = videoReducer(initialVideoState(120), { type: 'ended' })
    expect(ended.ended).toBe(true)
    expect(videoReducer(ended, { type: 'moved', time: 120, buffered: [] }).ended).toBe(true)
    expect(videoReducer(ended, { type: 'played' })).toMatchObject({ ended: false, paused: false })
    expect(videoReducer(ended, { type: 'sought', time: 0 })).toMatchObject({
      ended: false,
      time: 0,
    })
  })
})

describe('useWatchProgress state transitions', () => {
  it('starts on flowing frames, saves jumps, pause, end, pagehide and the final position', () => {
    const services = servicesFor()
    const position = { current: 20 }
    const wrapper = ({ children }: { children: ReactNode }) => (
      <PlayerServicesProvider services={services}>{children}</PlayerServicesProvider>
    )
    const initial = initialVideoState(20)
    const { rerender, unmount } = renderHook(
      ({ state }) => useWatchProgress({ state, position, duration: 120 }),
      { initialProps: { state: initial }, wrapper },
    )
    rerender({ state: { ...initial, paused: false, waiting: true } })
    expect(services.progress.started).not.toHaveBeenCalled()
    rerender({ state: { ...initial, paused: false } })
    expect(services.progress.started).toHaveBeenCalledTimes(1)
    position.current = 29
    rerender({ state: { ...initial, paused: false, time: 29 } })
    expect(services.progress.save).not.toHaveBeenCalled()
    position.current = 31
    rerender({ state: { ...initial, paused: false, time: 31 } })
    expect(services.progress.save).toHaveBeenLastCalledWith(31)
    position.current = 25
    rerender({ state: { ...initial, time: 25 } })
    expect(services.progress.save).toHaveBeenLastCalledWith(25)
    position.current = 120
    rerender({ state: { ...initial, time: 120, ended: true } })
    expect(services.progress.save).toHaveBeenLastCalledWith(120)
    expect(services.progress.save).toHaveBeenCalledTimes(3)
    rerender({ state: { ...initial, time: 120, ended: true, rate: 2 } })
    expect(services.progress.save).toHaveBeenCalledTimes(3)
    act(() => window.dispatchEvent(new Event('pagehide')))
    expect(services.progress.save).toHaveBeenLastCalledWith(120)
    position.current = 118
    unmount()
    expect(services.progress.save).toHaveBeenLastCalledWith(118)
    expect(services.progress.left).toHaveBeenCalledWith(118)
    expect(services.progress.started).toHaveBeenCalledTimes(1)
  })

  it('never wipes a resume point when frames did not play, but still reports leaving', () => {
    const services = servicesFor()
    const wrapper = ({ children }: { children: ReactNode }) => (
      <PlayerServicesProvider services={services}>{children}</PlayerServicesProvider>
    )
    const position = { current: 0 }
    const { unmount } = renderHook(
      () => useWatchProgress({ state: initialVideoState(20), position, duration: null }),
      { wrapper },
    )
    act(() => window.dispatchEvent(new Event('pagehide')))
    unmount()
    expect(services.progress.save).not.toHaveBeenCalled()
    expect(services.progress.started).not.toHaveBeenCalled()
    expect(services.progress.left).toHaveBeenCalledWith(0)
  })
})

describe('PlayerChrome with a fake engine handle', () => {
  it('renders a non-video surface and routes buttons, settings and shortcuts to actions', async () => {
    const services = servicesFor()
    const actions = actionsFor()
    const engine: EngineHandle = {
      state: initialVideoState(20),
      duration: 120,
      position: { current: 20 },
      tracks: null,
      actions,
      focusSurface: mock(() => {}),
      surface: <p>Engine picture</p>,
      drawsSubtitles: true,
    }
    const { container } = renderWithProviders(
      <PlayerServicesProvider services={services}>
        <PlayerChrome
          engine={engine}
          onBack={() => {}}
          mode="direct"
          selection={selection}
          subtitleStatus="off"
          fullscreen={{ fullscreen: false, toggle: () => {} }}
        />
      </PlayerServicesProvider>,
    )
    expect(container.querySelector('video')).toBeNull()
    expect(screen.getByText('Engine picture')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Play (k)' }))
    expect(actions.play).toHaveBeenCalledTimes(1)
    fireEvent.keyDown(window, { key: 'ArrowRight' })
    expect(actions.seek).toHaveBeenLastCalledWith(25)
    fireEvent.keyDown(window, { key: 'ArrowUp' })
    expect(actions.setVolume).toHaveBeenCalled()
    fireEvent.keyDown(window, { key: 'm' })
    expect(actions.setVolume).toHaveBeenCalled()
    fireEvent.keyDown(window, { key: '>' })
    expect(actions.setRate).toHaveBeenCalled()
    fireEvent.keyDown(window, { key: '+' })
    expect(actions.setSubtitleScale).toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: 'Start over' }))
    expect(actions.seek).toHaveBeenLastCalledWith(0)
    expect(actions.play).toHaveBeenCalledTimes(2)
    expect(engine.focusSurface).toHaveBeenCalledTimes(1)
  })
})

describe('Player HTML local files', () => {
  it('plays the URL directly, resumes, uses no server queries, and releases its source', async () => {
    const tracks = spyOn(api, 'getTracks')
    const settings = spyOn(api, 'getPlaybackSettings')
    try {
      const services = servicesFor()
      const { container, unmount } = renderWithProviders(
        <PlayerServicesProvider services={services}>
          <Player engine={{ kind: 'html', source: { kind: 'file', url: 'blob:local-clip' } }} />
        </PlayerServicesProvider>,
      )
      const video = container.querySelector('video')
      expect(video).not.toBeNull()
      if (!video) return
      expect(video).toHaveAttribute('src', 'blob:local-clip')
      const play = spyOn(video, 'play').mockImplementation(async () => {})
      fireEvent.loadedMetadata(video)
      expect(video.currentTime).toBe(20)
      fireEvent.play(video)
      fireEvent.canPlay(video)
      expect(services.progress.started).not.toHaveBeenCalled()
      fireEvent.playing(video)
      expect(services.progress.started).toHaveBeenCalledTimes(1)
      play.mockRestore()
      await userEvent.click(screen.getByRole('button', { name: 'Start over' }))
      expect(video.currentTime).toBe(0)
      expect(document.activeElement).toBe(video)
      await userEvent.click(screen.getByRole('button', { name: 'Settings' }))
      expect(screen.queryByText('Reading tracks')).toBeNull()
      expect(tracks).not.toHaveBeenCalled()
      expect(settings).not.toHaveBeenCalled()
      unmount()
      expect(video).not.toHaveAttribute('src')
    } finally {
      tracks.mockRestore()
      settings.mockRestore()
    }
  })
})

describe('HTML engine surface focus', () => {
  it('is safe before the surface exists and after it unmounts', () => {
    const handles: EngineHandle[] = []
    const Probe = () => {
      const { engine } = useHtmlEngine({
        source: { kind: 'file', url: 'blob:local-clip' },
        mode: 'direct',
        selection,
        onFailure: () => {},
        toggleFullscreen: () => {},
      })
      useEffect(() => {
        handles.push(engine)
      })
      return null
    }
    const { unmount } = renderWithProviders(
      <PlayerServicesProvider services={servicesFor()}>
        <Probe />
      </PlayerServicesProvider>,
    )
    const handle = handles.at(-1)
    expect(handle).toBeDefined()
    if (!handle) return
    expect(() => handle.focusSurface()).not.toThrow()
    unmount()
    expect(() => handle.focusSurface()).not.toThrow()
  })
})
