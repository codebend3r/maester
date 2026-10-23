import { afterEach, beforeEach, describe, expect, it, jest, mock, spyOn } from 'bun:test'
import type { PlayerAction } from '@raven/core'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { type ReactNode, useEffect } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { Player } from '@/components/Player/Player'
import type { HostActions, PlayerServices } from '@/components/Player/PlayerServices'
import { DIRECT_RENDITION } from '@/components/Player/rendition'
import { PlayerChrome } from '@/components/Player/Stage'
import { Unplayable } from '@/components/Player/Unplayable'
import type { EngineActions, EngineHandle } from '@/components/Player/engine'
import type { TrackSelection } from '@/components/Player/useTrackSelection'
import { useHtmlEngine } from '@/components/Player/useHtmlEngine'
import { initialVideoState, videoReducer } from '@/components/Player/videoState'
import { useWatchProgress } from '@/components/Player/useWatchProgress'
import { api } from '@/test/api'
import { renderWithProviders } from '@/test/render'
import { PLAYER_PREFS_KEY, usePlayerPrefs } from '@/stores/playerPrefs'
import { usePlayerServices } from '@/stores/playerServices'

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
    usePlayerServices.setState({ services })
    const initial = { ...initialVideoState(20), waiting: false }
    const { rerender, unmount } = renderHook(
      ({ state }) => useWatchProgress({ state, position, duration: 120, audio: 1 }),
      { initialProps: { state: initial } },
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
    expect(services.progress.save).toHaveBeenLastCalledWith({ position: 31, audio: 1 })
    position.current = 25
    rerender({ state: { ...initial, time: 25 } })
    expect(services.progress.save).toHaveBeenLastCalledWith({ position: 25, audio: 1 })
    position.current = 120
    rerender({ state: { ...initial, time: 120, ended: true } })
    expect(services.progress.save).toHaveBeenLastCalledWith({ position: 120, audio: 1 })
    expect(services.progress.save).toHaveBeenCalledTimes(3)
    rerender({ state: { ...initial, time: 120, ended: true, rate: 2 } })
    expect(services.progress.save).toHaveBeenCalledTimes(3)
    act(() => window.dispatchEvent(new Event('pagehide')))
    expect(services.progress.save).toHaveBeenLastCalledWith({ position: 120, audio: 1 })
    position.current = 118
    unmount()
    expect(services.progress.save).toHaveBeenLastCalledWith({ position: 118, audio: 1 })
    expect(services.progress.left).toHaveBeenCalledWith(118)
    expect(services.progress.started).toHaveBeenCalledTimes(1)
  })

  it('never wipes a resume point when frames did not play, but still reports leaving', () => {
    const services = servicesFor()
    usePlayerServices.setState({ services })
    const position = { current: 0 }
    const { unmount } = renderHook(() =>
      useWatchProgress({ state: initialVideoState(20), position, duration: null, audio: null }),
    )
    act(() => window.dispatchEvent(new Event('pagehide')))
    unmount()
    expect(services.progress.save).not.toHaveBeenCalled()
    expect(services.progress.started).not.toHaveBeenCalled()
    expect(services.progress.left).toHaveBeenCalledWith(0)
  })
})

describe('useWatchProgress duration sink', () => {
  it("reports the engine's duration to an optional duration sink once known", () => {
    const duration = mock((_seconds: number) => {})
    const services: PlayerServices = {
      ...servicesFor(),
      progress: { ...servicesFor().progress, duration },
    }
    const position = { current: 0 }
    usePlayerServices.setState({ services })
    const state = initialVideoState(0)
    const initialProps: { length: number | null } = { length: null }
    const { rerender } = renderHook(
      ({ length }: { length: number | null }) =>
        useWatchProgress({ state, position, duration: length, audio: null }),
      { initialProps },
    )
    expect(duration).not.toHaveBeenCalled()
    rerender({ length: 120 })
    expect(duration).toHaveBeenCalledTimes(1)
    expect(duration).toHaveBeenCalledWith(120)
    rerender({ length: 120 })
    expect(duration).toHaveBeenCalledTimes(1)
  })

  it('renders without throwing when the sink has no duration', () => {
    const services = servicesFor()
    usePlayerServices.setState({ services })
    expect(() =>
      renderHook(() =>
        useWatchProgress({
          state: initialVideoState(0),
          position: { current: 0 },
          duration: 120,
          audio: null,
        }),
      ),
    ).not.toThrow()
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
      readStats: () => ({ engine: 'Test engine', viewport: null, frame: null, frames: null }),
    }
    const { container } = renderWithProviders({
      ui: (
        <PlayerChrome
          engine={engine}
          onBack={() => {}}
          rendition={DIRECT_RENDITION}
          selection={selection}
          subtitleStatus="off"
          fullscreen={{ fullscreen: false, toggle: () => {} }}
        />
      ),
      services: services,
    })
    expect(container.querySelector('video')).toBeNull()
    expect(screen.getByText('Engine picture')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Play (k)' }))
    expect(actions.play).toHaveBeenCalledTimes(1)
    fireEvent.keyDown(window, { key: 'ArrowRight' })
    expect(actions.seek).toHaveBeenLastCalledWith(30)
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

describe('PlayerChrome Playback info', () => {
  it('puts the resume notice away, since the panel opens over it', async () => {
    const engine: EngineHandle = {
      state: initialVideoState(20),
      duration: 120,
      position: { current: 20 },
      tracks: null,
      actions: actionsFor(),
      focusSurface: mock(() => {}),
      surface: <p>Engine picture</p>,
      drawsSubtitles: true,
      readStats: () => ({ engine: 'Test engine', viewport: null, frame: null, frames: null }),
    }
    renderWithProviders({
      ui: (
        <PlayerChrome
          engine={engine}
          onBack={() => {}}
          rendition={DIRECT_RENDITION}
          selection={selection}
          subtitleStatus="off"
          fullscreen={{ fullscreen: false, toggle: () => {} }}
        />
      ),
      services: servicesFor(),
    })
    expect(screen.getByRole('button', { name: 'Start over' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /^Playback:/ }))
    await userEvent.click(screen.getByRole('button', { name: 'Playback info' }))
    expect(screen.getByRole('dialog', { name: 'Playback info' })).toBeInTheDocument()
    expect(screen.getByText('Test engine')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Start over' })).toBeNull()
  })
})

describe('PlayerChrome host actions', () => {
  it('acts on actions the host sends', () => {
    const listeners = new Set<(action: PlayerAction) => void>()
    const hostActions: HostActions = {
      subscribe: (listener) => {
        listeners.add(listener)
        return () => listeners.delete(listener)
      },
    }
    const emit = (action: PlayerAction) => listeners.forEach((listener) => listener(action))
    const services: PlayerServices = { ...servicesFor(), hostActions }
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
      readStats: () => ({ engine: 'Test engine', viewport: null, frame: null, frames: null }),
    }
    const { unmount } = renderWithProviders({
      ui: (
        <PlayerChrome
          engine={engine}
          onBack={() => {}}
          rendition={DIRECT_RENDITION}
          selection={selection}
          subtitleStatus="off"
          fullscreen={{ fullscreen: false, toggle: () => {} }}
        />
      ),
      services: services,
    })
    expect(listeners.size).toBe(1)
    act(() => emit({ type: 'togglePlay' }))
    expect(actions.play).toHaveBeenCalledTimes(1)
    act(() => emit({ type: 'skip', direction: 1 }))
    expect(actions.seek).toHaveBeenLastCalledWith(30)
    unmount()
    expect(listeners.size).toBe(0)
  })
})

describe('Player HTML local files', () => {
  it('plays the URL directly, resumes, uses no server queries, and releases its source', async () => {
    const tracks = spyOn(api, 'getTracks')
    const settings = spyOn(api, 'getPlaybackSettings')
    try {
      const services = servicesFor()
      const { container, unmount } = renderWithProviders({
        ui: <Player engine={{ kind: 'html', source: { kind: 'file', url: 'blob:local-clip' } }} />,
        services: services,
      })
      const video = container.querySelector('video')
      expect(video).not.toBeNull()
      if (!video) return
      expect(video).toHaveAttribute('src', 'blob:local-clip')
      const play = spyOn(video, 'play').mockImplementation(async () => {})
      fireEvent.loadedMetadata(video)
      expect(video.currentTime).toBe(20)
      Object.defineProperty(video, 'paused', { value: false, configurable: true })
      fireEvent.play(video)
      fireEvent.canPlay(video)
      expect(services.progress.started).not.toHaveBeenCalled()
      fireEvent.playing(video)
      expect(services.progress.started).toHaveBeenCalledTimes(1)
      play.mockRestore()
      await userEvent.click(screen.getByRole('button', { name: 'Start over' }))
      expect(video.currentTime).toBe(0)
      expect(document.activeElement).toBe(video)
      await userEvent.click(screen.getByRole('button', { name: /^Audio/ }))
      expect(screen.getByText('No audio tracks.')).toBeInTheDocument()
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

describe('the line under a local file’s title', () => {
  const aboutOf = (services: PlayerServices) => {
    usePlayerServices.setState({ services })
    renderWithProviders({
      ui: <Player engine={{ kind: 'html', source: { kind: 'file', url: 'blob:local-clip' } }} />,
    })
    return screen.getByRole('heading', { level: 1, name: 'Local clip' }).nextElementSibling
  }

  it('says only how it plays when the host names no context', () => {
    expect(aboutOf(servicesFor())).toHaveTextContent(/^Direct play$/)
  })

  it('says where it came from before how it plays', () => {
    const services = servicesFor()
    expect(
      aboutOf({ ...services, title: { ...services.title, context: 'Downloaded from Vhagar' } }),
    ).toHaveTextContent(/^Downloaded from Vhagar · Direct play$/)
  })
})

describe('HTML engine surface focus', () => {
  it('is safe before the surface exists and after it unmounts', () => {
    const handles: EngineHandle[] = []
    const Probe = () => {
      const { engine } = useHtmlEngine({
        source: { kind: 'file', url: 'blob:local-clip' },
        rendition: DIRECT_RENDITION,
        selection,
        onFailure: () => {},
        toggleFullscreen: () => {},
      })
      useEffect(() => {
        handles.push(engine)
      })
      return null
    }
    const { unmount } = renderWithProviders({ ui: <Probe />, services: servicesFor() })
    const handle = handles.at(-1)
    expect(handle).toBeDefined()
    if (!handle) return
    expect(() => handle.focusSurface()).not.toThrow()
    unmount()
    expect(() => handle.focusSurface()).not.toThrow()
  })
})

describe('HTML engine stats', () => {
  it('reads the picture from the video element, and nothing once it is gone', () => {
    const handles: EngineHandle[] = []
    const Probe = () => {
      const { engine } = useHtmlEngine({
        source: { kind: 'file', url: 'blob:local-clip' },
        rendition: DIRECT_RENDITION,
        selection,
        onFailure: () => {},
        toggleFullscreen: () => {},
      })
      useEffect(() => {
        handles.push(engine)
      })
      return engine.surface
    }
    const { container, unmount } = renderWithProviders({ ui: <Probe />, services: servicesFor() })
    const handle = handles.at(-1)
    const video = container.querySelector('video')
    expect(handle).toBeDefined()
    expect(video).not.toBeNull()
    if (!handle || !video) return
    const nothing = { engine: 'HTML video', viewport: null, frame: null, frames: null }
    expect(handle.readStats()).toEqual(nothing)
    Object.defineProperty(video, 'clientWidth', { value: 1280 })
    Object.defineProperty(video, 'clientHeight', { value: 720 })
    Object.defineProperty(video, 'videoWidth', { value: 1920 })
    Object.defineProperty(video, 'videoHeight', { value: 800 })
    video.getVideoPlaybackQuality = () => ({
      creationTime: 0,
      droppedVideoFrames: 2,
      corruptedVideoFrames: 0,
      totalVideoFrames: 100,
    })
    expect(handle.readStats()).toEqual({
      engine: 'HTML video',
      viewport: { width: 1280, height: 720, scale: window.devicePixelRatio },
      frame: { width: 1920, height: 800 },
      frames: { dropped: 2, total: 100 },
    })
    unmount()
    expect(handle.readStats()).toEqual(nothing)
  })
})

describe('PlayerChrome seams for a native host', () => {
  const IDLE_MS = 5_000
  beforeEach(() => jest.useFakeTimers())
  afterEach(() => jest.useRealTimers())

  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  )

  const chrome = ({
    services,
    actions,
    time = 20,
  }: {
    services: PlayerServices
    actions: EngineActions
    time?: number
  }) => {
    const engine: EngineHandle = {
      state: { ...initialVideoState(time), paused: false },
      duration: 120,
      position: { current: time },
      tracks: null,
      actions,
      readStats: () => ({ engine: 'Test engine', viewport: null, frame: null, frames: null }),
      focusSurface: () => {},
      surface: <p>Engine picture</p>,
      drawsSubtitles: true,
    }
    // Set before the render this element goes to, as a host does.
    usePlayerServices.setState({ services })
    return (
      <PlayerChrome
        engine={engine}
        onBack={() => {}}
        rendition={DIRECT_RENDITION}
        selection={selection}
        subtitleStatus="off"
        fullscreen={{ fullscreen: false, toggle: () => {} }}
      />
    )
  }
  const idle = (ms: number) => act(() => jest.advanceTimersByTime(ms))
  const seekSlider = () => screen.getByRole('slider', { name: 'Seek' })

  it('holds the time played and the scrubber still while the controls are hidden', () => {
    const services = servicesFor()
    const actions = actionsFor()
    const { container, rerender } = render(chrome({ services, actions }), { wrapper })
    rerender(chrome({ services, actions, time: 30 }))
    expect(seekSlider()).toHaveAttribute('aria-valuenow', '30')
    idle(IDLE_MS)
    rerender(chrome({ services, actions, time: 40 }))
    expect(seekSlider()).toHaveAttribute('aria-valuenow', '30')
    expect(container.querySelector('.elapsed')).toHaveTextContent('0:30')
    fireEvent.pointerMove(container.querySelector('.stage') ?? container)
    expect(seekSlider()).toHaveAttribute('aria-valuenow', '40')
    expect(container.querySelector('.elapsed')).toHaveTextContent('0:40')
  })

  it('tells the host when the controls show and hide', () => {
    const shown = mock((_isShown: boolean) => {})
    const services: PlayerServices = { ...servicesFor(), chrome: { shown } }
    const { container, unmount } = render(chrome({ services, actions: actionsFor() }), {
      wrapper,
    })
    expect(shown.mock.calls).toEqual([[true]])
    idle(IDLE_MS)
    expect(shown).toHaveBeenLastCalledWith(false)
    fireEvent.pointerMove(container.querySelector('.stage') ?? container)
    expect(shown).toHaveBeenLastCalledWith(true)
    shown.mockClear()
    idle(IDLE_MS)
    shown.mockClear()
    unmount()
    expect(shown.mock.calls).toEqual([[true]])
  })

  it('toggles video info only for an engine that has it', () => {
    const toggleStats = mock(() => {})
    const withStats = render(
      chrome({ services: servicesFor(), actions: { ...actionsFor(), toggleStats } }),
      { wrapper },
    )
    // fireEvent answers false when the page prevented the key's default.
    expect(fireEvent.keyDown(window, { key: 'i' })).toBe(false)
    expect(toggleStats).toHaveBeenCalledTimes(1)
    fireEvent.keyDown(window, { key: '?' })
    expect(screen.getByText('Video info')).toBeInTheDocument()
    withStats.unmount()

    const actions = actionsFor()
    render(chrome({ services: servicesFor(), actions }), { wrapper })
    // The web has no overlay, so `i` stays the page's.
    expect(fireEvent.keyDown(window, { key: 'i' })).toBe(true)
    fireEvent.keyDown(window, { key: '?' })
    expect(screen.getByText('These shortcuts')).toBeInTheDocument()
    expect(screen.queryByText('Video info')).toBeNull()
  })

  it('keeps volume fixed when the host says so', () => {
    const actions = actionsFor()
    const services: PlayerServices = { ...servicesFor(), isVolumeFixed: true }
    const { container } = render(chrome({ services, actions }), { wrapper })
    const slider = screen.getByRole('slider', { name: 'Volume' })
    expect(slider).toBeDisabled()
    expect(slider).toHaveAccessibleDescription('Volume is set on your receiver')
    const mute = screen.getByRole('button', { name: 'Volume is set on your receiver' })
    expect(mute).toBeDisabled()
    fireEvent.keyDown(window, { key: 'ArrowUp' })
    fireEvent.keyDown(window, { key: 'm' })
    expect(actions.setVolume).not.toHaveBeenCalled()
    expect(container.querySelector('[aria-live="polite"]')).toHaveTextContent(
      'Volume is set on your receiver',
    )
  })

  it('leaves volume alone on the web', () => {
    const actions = actionsFor()
    render(chrome({ services: servicesFor(), actions }), { wrapper })
    expect(screen.getByRole('slider', { name: 'Volume' })).toBeEnabled()
    expect(screen.getByRole('slider', { name: 'Volume' })).not.toHaveAccessibleDescription()
    expect(screen.getByRole('button', { name: 'Mute (m)' })).toBeEnabled()
    fireEvent.keyDown(window, { key: 'ArrowUp' })
    expect(actions.setVolume).toHaveBeenCalledTimes(1)
  })
})

describe('Player shows the host note on Unplayable', () => {
  const failing = (note: string | undefined) => {
    const services: PlayerServices = { ...servicesFor(), unplayableNote: note }
    const { container } = renderWithProviders({
      ui: <Player engine={{ kind: 'html', source: { kind: 'file', url: 'blob:broken' } }} />,
      services: services,
    })
    const video = container.querySelector('video')
    expect(video).not.toBeNull()
    if (video) fireEvent.error(video)
  }

  it("shows the host's note", () => {
    failing('raven player could not play this video.')
    expect(screen.getByText('raven player could not play this video.')).toBeInTheDocument()
    expect(screen.queryByText("This video can't play in this browser.")).toBeNull()
  })

  it('keeps the browser wording without a note', () => {
    failing(undefined)
    expect(screen.getByText("This video can't play in this browser.")).toBeInTheDocument()
  })
})

describe('Player hands a title off to another player', () => {
  const VLC_HINT =
    'The file is served untouched, so a player that handles every format, like VLC or IINA, can open the same link.'

  const failing = (services: PlayerServices) => {
    const { container } = renderWithProviders({
      ui: <Player engine={{ kind: 'html', source: { kind: 'file', url: 'blob:broken' } }} />,
      services: services,
    })
    const video = container.querySelector('video')
    expect(video).not.toBeNull()
    if (video) fireEvent.error(video)
    return { container }
  }

  const panelButtons = () =>
    within(screen.getByRole('region', { name: 'Local clip' }))
      .getAllByRole('button')
      .map((button) => button.textContent)

  it("offers the host's handoff first on Unplayable", async () => {
    const run = mock((_at: number) => {})
    const copy = mock(() => {})
    failing({
      ...servicesFor(),
      handoff: { label: 'Open in raven player', run },
      escape: { label: 'Copy file link', run: copy },
    })
    expect(panelButtons()).toEqual(['Back', 'Open in raven player', 'Copy file link'])
    const handoff = screen.getByRole('button', { name: 'Open in raven player' })
    expect(handoff).toHaveClass('primary')
    expect(handoff.querySelector('[data-icon]')).toHaveAttribute('data-icon', 'play')
    await userEvent.click(handoff)
    expect(run).toHaveBeenCalledTimes(1)
    expect(run).toHaveBeenCalledWith(20)
    expect(copy).not.toHaveBeenCalled()
  })

  it('keeps Unplayable as it was without a handoff', () => {
    failing({ ...servicesFor(), escape: { label: 'Copy file link', run: () => {} } })
    expect(panelButtons()).toEqual(['Back', 'Copy file link'])
    const copy = screen.getByRole('button', { name: 'Copy file link' })
    expect(copy.querySelector('[data-icon]')).toHaveAttribute('data-icon', 'copy')
    expect(screen.getByText(VLC_HINT)).toBeInTheDocument()
    cleanup()

    failing({
      ...servicesFor(),
      escape: { label: 'Open in browser', run: () => {}, icon: 'globe' },
      escapeHint: null,
    })
    const browser = screen.getByRole('button', { name: 'Open in browser' })
    expect(browser.querySelector('[data-icon]')).toHaveAttribute('data-icon', 'globe')
    expect(screen.queryByText(VLC_HINT)).toBeNull()
    cleanup()

    failing({
      ...servicesFor(),
      escape: { label: 'Open in browser', run: () => {} },
      escapeHint: 'The browser can play it.',
    })
    expect(screen.getByText('The browser can play it.')).toBeInTheDocument()
    expect(screen.queryByText(VLC_HINT)).toBeNull()
  })

  it('writes no hint paragraph for an empty hint', () => {
    const { container } = failing({
      ...servicesFor(),
      escape: { label: 'Open in browser', run: () => {} },
      escapeHint: '',
    })
    expect(screen.queryByText(VLC_HINT)).toBeNull()
    const hints = [...container.querySelectorAll('p')].filter(
      (paragraph) => paragraph.getAttribute('aria-live') === null && paragraph.textContent === '',
    )
    expect(hints).toEqual([])
  })

  it('drops Try playing anyway from primary only while a handoff is offered', () => {
    const unplayable = (services: PlayerServices) =>
      renderWithProviders({
        ui: (
          <Unplayable problems={['No way to convert']} onBack={() => {}} onTryAnyway={() => {}} />
        ),
        services: services,
      })
    unplayable(servicesFor())
    expect(screen.getByRole('button', { name: 'Try playing anyway' })).toHaveClass('primary')
    cleanup()

    unplayable({ ...servicesFor(), handoff: { label: 'Open in raven player', run: () => {} } })
    expect(screen.getByRole('button', { name: 'Open in raven player' })).toHaveClass('primary')
    expect(screen.getByRole('button', { name: 'Try playing anyway' })).not.toHaveClass('primary')
  })
})

describe('PlayerChrome handoff in the playback menu', () => {
  const chrome = ({ services, actions }: { services: PlayerServices; actions: EngineActions }) => {
    const engine: EngineHandle = {
      state: { ...initialVideoState(20), paused: false },
      duration: 120,
      position: { current: 42.7 },
      tracks: null,
      actions,
      readStats: () => ({ engine: 'Test engine', viewport: null, frame: null, frames: null }),
      focusSurface: () => {},
      surface: <p>Engine picture</p>,
      drawsSubtitles: true,
    }
    return renderWithProviders({
      ui: (
        <PlayerChrome
          engine={engine}
          onBack={() => {}}
          rendition={DIRECT_RENDITION}
          selection={selection}
          subtitleStatus="off"
          fullscreen={{ fullscreen: false, toggle: () => {} }}
        />
      ),
      services: services,
    })
  }

  it('offers the handoff in the playback menu, paused, at the current position', async () => {
    const order: string[] = []
    const actions: EngineActions = {
      ...actionsFor(),
      pause: mock(() => {
        order.push('pause')
      }),
    }
    const run = mock((_at: number) => {
      order.push('run')
    })
    chrome({
      services: { ...servicesFor(), handoff: { label: 'Open in raven player', run } },
      actions,
    })
    await userEvent.click(screen.getByRole('button', { name: /^Playback:/ }))
    const menu = await screen.findByRole('dialog', { name: 'Playback' })
    const handoff = within(menu).getByRole('button', { name: 'Open in raven player' })
    expect(handoff.querySelector('[data-icon]')).toHaveAttribute('data-icon', 'play')
    await userEvent.click(handoff)
    expect(order).toEqual(['pause', 'run'])
    expect(run).toHaveBeenCalledWith(42.7)
    expect(screen.queryByRole('dialog', { name: 'Playback' })).toBeNull()
    await waitFor(() => expect(screen.getByRole('button', { name: /^Playback:/ })).toHaveFocus())
  })

  it('has no handoff in the playback menu without one', async () => {
    chrome({ services: servicesFor(), actions: actionsFor() })
    await userEvent.click(screen.getByRole('button', { name: /^Playback:/ }))
    const menu = await screen.findByRole('dialog', { name: 'Playback' })
    expect(within(menu).queryByRole('button', { name: 'Open in raven player' })).toBeNull()
  })
})

describe('player preferences', () => {
  it('remembers whether to open videos in raven player', () => {
    expect(usePlayerPrefs.getState().opensInRavenPlayer).toBe(false)
    act(() => usePlayerPrefs.getState().setOpensInRavenPlayer(true))
    expect(usePlayerPrefs.getState().opensInRavenPlayer).toBe(true)
    expect(window.localStorage.getItem(PLAYER_PREFS_KEY)).toContain('"opensInRavenPlayer":true')
  })
})
