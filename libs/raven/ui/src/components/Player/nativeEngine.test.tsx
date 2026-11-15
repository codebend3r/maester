import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from 'bun:test'
import {
  CAPTION_COLOURS,
  CAPTION_SIZES,
  DEFAULT_CAPTION_STYLE,
  ITEM_TYPES,
  type MediaTracks,
  PLAYER_COMMANDS,
  type PlayerCommand,
  type PlayerEvent,
} from '@raven/core'
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { Route, Routes } from 'react-router-dom'
import type { NativePlayer, PlaybackFile } from '@/components/Player/engine'
import { Player } from '@/components/Player/Player'
import type { PlayerServices } from '@/components/Player/PlayerServices'
import { api } from '@/test/api'
import { itemSummary, mediaItem } from '@/test/fixtures'
import { renderWithProviders } from '@/test/render'
import { usePlayerPrefs } from '@/stores/playerPrefs'
import { NO_TITLE_EXTRAS, NO_HOST_EXTRAS } from '@/components/Player/PlayerServices'

type FakePlayerProps = {
  deferLoad?: boolean
  loadError?: Error | null
  refuse?: PlayerCommand['type'][]
}

const fakePlayer = ({ deferLoad = false, loadError = null, refuse = [] }: FakePlayerProps = {}) => {
  const sent: PlayerCommand[] = []
  const listeners = new Set<(event: PlayerEvent) => void>()
  const held: { resolve: () => void; reject: (error: Error) => void }[] = []
  const player: NativePlayer = {
    send: (command) => {
      sent.push(command)
      if (refuse.includes(command.type)) return Promise.reject(new Error('Not now.'))
      if (command.type !== PLAYER_COMMANDS.load) return Promise.resolve()
      if (loadError) return Promise.reject(loadError)
      if (!deferLoad) return Promise.resolve()
      return new Promise<void>((resolve, reject) => {
        held.push({ resolve, reject })
      })
    },
    subscribe: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
  type FakePlayerRefuseLoadProps = { index?: number; message: string }

  return {
    player,
    sent,
    answerLoad: (index = held.length - 1) => held[index].resolve(),
    refuseLoad: ({ index = held.length - 1, message }: FakePlayerRefuseLoadProps) =>
      held[index].reject(new Error(message)),
    emit: (event: PlayerEvent) => act(() => listeners.forEach((listener) => listener(event))),
    listenerCount: () => listeners.size,
  }
}

const TRACKS: MediaTracks = {
  audio: [
    { index: 0, codec: 'aac', channels: 2, language: 'en', title: null, default: true },
    { index: 1, codec: 'aac', channels: 2, language: 'fr', title: null, default: false },
  ],
  subtitles: [
    {
      id: 'embedded-0',
      source: 'embedded',
      codec: 'subrip',
      language: 'en',
      title: null,
      default: false,
      forced: false,
      hearingImpaired: false,
      supported: true,
    },
  ],
  defaultAudio: 0,
  frameRate: 24,
}

const SOURCE = { kind: 'file', fileId: 'f1' } as const

const servicesFor = (overrides: Partial<PlayerServices> = {}): PlayerServices => ({
  title: {
    ...NO_TITLE_EXTRAS,
    label: 'Local clip',
    duration: null,
    resumeAt: 0,
    backTo: '/',
    next: { to: '/next', state: null, label: 'Next clip' },
  },
  progress: { started: () => {}, save: () => {}, left: () => {}, duration: null },
  posterUrl: null,
  ...NO_HOST_EXTRAS,
  escape: null,
  unplayableNote: 'Raven could not play this video.',
  ...overrides,
})

type HostProps = { player: NativePlayer; file?: PlaybackFile | null }

// The engine and its source are rebuilt on every render, as a host's would be.
const Host = ({ player, file = null }: HostProps) => {
  const [renders, setRenders] = useState(0)
  const [fileId, setFileId] = useState('f1')
  const [isShown, setIsShown] = useState(true)
  return (
    <>
      <button type="button" onClick={() => setRenders(renders + 1)}>
        Rerender {renders}
      </button>
      <button type="button" onClick={() => setFileId('f2')}>
        Change video
      </button>
      <button type="button" onClick={() => setIsShown(false)}>
        Leave
      </button>
      {isShown && (
        <Player engine={{ kind: 'native', player, source: { kind: 'file', fileId }, file }} />
      )}
    </>
  )
}

type RenderNativeProps = {
  player: NativePlayer
  services?: PlayerServices
  file?: PlaybackFile | null
}

const renderNative = ({ player, services = servicesFor(), file = null }: RenderNativeProps) =>
  renderWithProviders({
    ui: (
      <Routes>
        <Route path="/" element={<Host player={player} file={file} />} />
        <Route path="/next" element={<p>Next page</p>} />
      </Routes>
    ),
    services,
  })

const settled = () => act(async () => {})

const types = (sent: PlayerCommand[]) => sent.map((command) => command.type)

const spies: Array<{ mockRestore: () => void }> = []

beforeEach(() => {
  spies.push(spyOn(api, 'getCaptionStyle').mockImplementation(async () => DEFAULT_CAPTION_STYLE))
  usePlayerPrefs.setState({
    volume: 1,
    muted: false,
    captionStyle: DEFAULT_CAPTION_STYLE,
    subtitles: { on: false, language: null },
    audioLanguage: null,
  })
})

afterEach(() => {
  spies.splice(0).forEach((spy) => spy.mockRestore())
  delete document.documentElement.dataset.surface
})

describe('the native engine', () => {
  it('heads a library episode as the web does: the show, its title and place, and the picture chips', async () => {
    const fake = fakePlayer()
    const episode = mediaItem({
      title: 'Last Stop',
      year: 2022,
      width: 3840,
      height: 2160,
      videoCodec: 'hevc',
      item: itemSummary({
        type: ITEM_TYPES.episode,
        title: 'Last Stop',
        year: 2022,
        show: { id: 9, title: 'Slow Horses' },
        season: 2,
        episode: 1,
      }),
    })
    const services = servicesFor({
      title: {
        ...servicesFor().title,
        label: 'Slow Horses · S02E01 · Last Stop',
        logo: { url: '/art/slow-horses.png', name: 'Slow Horses' },
      },
    })
    renderNative({ player: fake.player, services, file: { media: episode, api } })
    await settled()
    const heading = screen.getByRole('heading', { level: 1, name: 'Slow Horses' })
    expect(within(heading).getByRole('img', { name: 'Slow Horses' })).toHaveAttribute(
      'src',
      '/art/slow-horses.png',
    )
    expect(screen.getByText('Last Stop')).toBeInTheDocument()
    // mpv names the length once the file is open; until then the line has the place and the year.
    expect(screen.getByText(/^S02 · E01 · 2022$/)).toBeInTheDocument()
    const playingAs = screen.getByRole('list', { name: 'Playing as' })
    expect(within(playingAs).getByLabelText('Video resolution: 4K')).toHaveTextContent('4K')
    expect(within(playingAs).getByText('HEVC')).toBeInTheDocument()
    expect(within(playingAs).getByText('Direct play')).toBeInTheDocument()
  })

  it('loads the source at the resume point with the stored picks', async () => {
    const fake = fakePlayer()
    const services = servicesFor({
      title: { ...servicesFor().title, resumeAt: 20 },
      trackPicks: { start: { audio: 1, subtitle: 'embedded-0' }, save: mock(() => {}) },
    })
    const { container } = renderNative({ player: fake.player, services })
    await settled()
    expect(fake.sent.slice(0, 3)).toEqual([
      { type: 'load', source: SOURCE, start: 20, audio: 1, subtitle: 'embedded-0' },
      { type: 'volume', volume: 1, muted: false },
      { type: 'subtitleStyle', style: DEFAULT_CAPTION_STYLE },
    ])
    expect(container.querySelector('video')).toBeNull()
  })

  it('ignores events until the load is answered', async () => {
    const fake = fakePlayer({ deferLoad: true })
    renderNative({ player: fake.player })
    await fake.emit({ type: 'ended' })
    expect(screen.queryByText('Next page')).toBeNull()
    expect(types(fake.sent)).toEqual(['load'])
    fake.answerLoad()
    await settled()
    await fake.emit({ type: 'ended' })
    expect(await screen.findByText('Next page')).toBeInTheDocument()
  })

  it('folds events into the controls', async () => {
    const fake = fakePlayer()
    renderNative({ player: fake.player })
    await settled()
    await fake.emit({ type: 'paused', paused: false })
    expect(screen.getByRole('button', { name: 'Pause (k)' })).toBeInTheDocument()
    await fake.emit({ type: 'duration', duration: 120 })
    await fake.emit({ type: 'time', time: 42 })
    const slider = screen.getByRole('slider', { name: /seek/i })
    expect(slider).toHaveAttribute('aria-valuemax', '120')
    expect(slider).toHaveAttribute('aria-valuenow', '42')
  })

  it('applies the language preferences once tracks arrive', async () => {
    usePlayerPrefs.setState({ audioLanguage: 'fr', subtitles: { on: true, language: 'en' } })
    const fake = fakePlayer()
    const save = mock(() => {})
    renderNative({
      player: fake.player,
      services: servicesFor({ trackPicks: { start: null, save } }),
    })
    await settled()
    await fake.emit({ type: 'tracks', tracks: TRACKS })
    expect(fake.sent).toContainEqual({ type: 'audio', index: 1 })
    expect(fake.sent).toContainEqual({ type: 'subtitle', id: 'embedded-0' })
    expect(save).not.toHaveBeenCalled()
  })

  it('sends nothing for tracks the preferences do not pick', async () => {
    const fake = fakePlayer()
    renderNative({ player: fake.player })
    await settled()
    await fake.emit({ type: 'tracks', tracks: TRACKS })
    expect(types(fake.sent)).toEqual(['load', 'volume', 'subtitleStyle'])
  })

  it('keeps the stored picks when tracks arrive', async () => {
    usePlayerPrefs.setState({ audioLanguage: 'fr' })
    const fake = fakePlayer()
    const services = servicesFor({
      trackPicks: { start: { audio: 0, subtitle: null }, save: mock(() => {}) },
    })
    renderNative({ player: fake.player, services })
    await settled()
    await fake.emit({ type: 'tracks', tracks: TRACKS })
    expect(types(fake.sent)).toEqual(['load', 'volume', 'subtitleStyle'])
  })

  it('sends, remembers and saves a pick by hand', async () => {
    const fake = fakePlayer()
    const save = mock(() => {})
    renderNative({
      player: fake.player,
      services: servicesFor({ trackPicks: { start: null, save } }),
    })
    await settled()
    await fake.emit({ type: 'tracks', tracks: TRACKS })
    await userEvent.click(screen.getByRole('button', { name: /^Audio/ }))
    await userEvent.click(await screen.findByRole('radio', { name: /French/ }))
    expect(fake.sent).toContainEqual({ type: 'audio', index: 1 })
    expect(usePlayerPrefs.getState().audioLanguage).toBe('fr')
    expect(save).toHaveBeenCalledWith({ audio: 1, subtitle: null })
    expect(screen.getByRole('radio', { name: /French/ })).toBeChecked()

    await userEvent.click(screen.getByRole('button', { name: /^Subtitles/ }))
    await userEvent.click(
      within(screen.getByRole('group', { name: 'Subtitles' })).getByRole('radio', {
        name: /English/,
      }),
    )
    expect(fake.sent).toContainEqual({ type: 'subtitle', id: 'embedded-0' })
    expect(usePlayerPrefs.getState().subtitles).toEqual({ on: true, language: 'en' })
    expect(save).toHaveBeenLastCalledWith({ audio: 1, subtitle: 'embedded-0' })
  })

  it('clamps a seek short of the end', async () => {
    const fake = fakePlayer()
    renderNative({ player: fake.player })
    await settled()
    await fake.emit({ type: 'duration', duration: 120 })
    fireEvent.keyDown(window, { key: 'End' })
    expect(fake.sent.at(-1)).toEqual({ type: 'seek', time: 119.5 })
    fireEvent.keyDown(window, { key: 'Home' })
    expect(fake.sent.at(-1)).toEqual({ type: 'seek', time: 0 })
  })

  it('keeps the loading ring out from under a skip’s flash, and shows it once the flash ends', async () => {
    const fake = fakePlayer()
    renderNative({ player: fake.player })
    await settled()
    await fake.emit({ type: 'duration', duration: 120 })
    await fake.emit({ type: 'paused', paused: false })
    await fake.emit({ type: 'waiting', waiting: false })
    fireEvent.keyDown(window, { key: 'l' })
    await fake.emit({ type: 'waiting', waiting: true })
    expect(screen.queryByLabelText('Loading')).toBeNull()
    await act(() => new Promise((resolve) => setTimeout(resolve, 750)))
    expect(screen.getByLabelText('Loading')).toBeInTheDocument()
  })

  it('shows Unplayable on an error event', async () => {
    const fake = fakePlayer()
    renderNative({ player: fake.player })
    await settled()
    await fake.emit({ type: 'error', reason: 'decode', message: 'Bad frame' })
    expect(screen.getByText('Bad frame')).toBeInTheDocument()
    expect(screen.getByText('Raven could not play this video.')).toBeInTheDocument()
  })

  it('tells the host about an engine error before Unplayable shows', async () => {
    const fake = fakePlayer()
    const seen: string[] = []
    type OnEngineErrorMockCallbackProps = { reason: string; message: string }

    const onEngineError = mock((error: OnEngineErrorMockCallbackProps) => {
      seen.push(`${error.reason}: ${error.message}`)
      // Unplayable has not replaced the controls yet.
      if (screen.queryByText('Locked again') === null) seen.push('before Unplayable')
    })
    renderNative({ player: fake.player, services: servicesFor({ onEngineError }) })
    await settled()
    await fake.emit({ type: 'error', reason: 'locked', message: 'Locked again' })
    expect(onEngineError).toHaveBeenCalledTimes(1)
    expect(onEngineError).toHaveBeenCalledWith({ reason: 'locked', message: 'Locked again' })
    expect(seen).toEqual(['locked: Locked again', 'before Unplayable'])
    expect(screen.getByText('Locked again')).toBeInTheDocument()
  })

  it('still shows Unplayable when the host throws on an engine error', async () => {
    const fake = fakePlayer()
    // Delivered by hand, so the throw is caught inside `act` and the render still flushes.
    const listeners: ((event: PlayerEvent) => void)[] = []
    const player: NativePlayer = {
      ...fake.player,
      subscribe: (listener) => {
        listeners.push(listener)
        return fake.player.subscribe(listener)
      },
    }
    const onEngineError = mock(() => {
      throw new Error('host failed')
    })
    renderNative({ player, services: servicesFor({ onEngineError }) })
    await settled()
    const thrown: unknown[] = []
    act(() => {
      listeners.forEach((listener) => {
        try {
          listener({ type: 'error', reason: 'open', message: 'Could not open it' })
        } catch (error) {
          thrown.push(error)
        }
      })
    })
    expect(thrown).toHaveLength(1)
    expect(onEngineError).toHaveBeenCalledTimes(1)
    expect(await screen.findByText('Could not open it')).toBeInTheDocument()
  })

  it('shows Unplayable on a refused load', async () => {
    const fake = fakePlayer({ loadError: new Error('That video is no longer open.') })
    renderNative({ player: fake.player })
    await settled()
    expect(screen.getByText('That video is no longer open.')).toBeInTheDocument()
    expect(types(fake.sent)).not.toContain('volume')
  })

  it('stops and lets go on unmount', async () => {
    const fake = fakePlayer()
    const { unmount } = renderNative({ player: fake.player })
    await settled()
    // The last title's frame is still in the video layer, so the page stays opaque until this one has a frame.
    expect(document.documentElement.dataset.surface).toBeUndefined()
    await fake.emit({ type: 'waiting', waiting: false })
    expect(document.documentElement.dataset.surface).toBe('native')
    expect(fake.listenerCount()).toBe(1)
    unmount()
    expect(fake.sent.at(-1)).toEqual({ type: 'stop' })
    expect(fake.listenerCount()).toBe(0)
    expect(document.documentElement.dataset.surface).toBeUndefined()
  })

  it('offers video info and a surface that plays and pauses', async () => {
    const fake = fakePlayer()
    const { container } = renderNative({ player: fake.player })
    await settled()
    fireEvent.keyDown(window, { key: 'i' })
    expect(fake.sent.at(-1)).toEqual({ type: 'stats' })
    const surface = container.querySelector('[class*="nativeSurface"]')
    if (!(surface instanceof HTMLElement)) throw new Error('no native surface')
    await userEvent.click(surface)
    expect(fake.sent.at(-1)).toEqual({ type: 'play' })
    await fake.emit({ type: 'paused', paused: false })
    await userEvent.click(surface)
    expect(fake.sent.at(-1)).toEqual({ type: 'pause' })
  })

  it('names mpv in Playback info and leaves the picture figures to its overlay', async () => {
    const fake = fakePlayer()
    renderNative({ player: fake.player })
    await settled()
    await userEvent.click(screen.getByRole('button', { name: /^Playback:/ }))
    const menu = await screen.findByRole('dialog', { name: 'Playback' })
    await userEvent.click(within(menu).getByRole('button', { name: 'Playback info' }))
    const info = screen.getByRole('dialog', { name: 'Playback info' })
    expect(within(info).getByText('mpv')).toBeInTheDocument()
    expect(within(info).queryByText('Dropped frames')).toBeNull()
  })

  it('sends the rate, volume and caption size the controls choose', async () => {
    const fake = fakePlayer()
    renderNative({ player: fake.player })
    await settled()
    fireEvent.keyDown(window, { key: '>' })
    expect(fake.sent.at(-1)).toEqual({ type: 'speed', rate: 1.25 })
    fireEvent.keyDown(window, { key: 'ArrowDown' })
    expect(fake.sent.at(-1)).toMatchObject({ type: 'volume', muted: false })
    expect(usePlayerPrefs.getState().volume).toBeLessThan(1)
    fireEvent.keyDown(window, { key: '+' })
    await waitFor(() =>
      expect(fake.sent.at(-1)).toEqual({
        type: 'subtitleStyle',
        style: { size: CAPTION_SIZES.large, colour: CAPTION_COLOURS.white },
      }),
    )
    expect(usePlayerPrefs.getState().captionStyle.size).toBe(CAPTION_SIZES.large)
  })

  it("draws a library file's subtitles in the account's look once the server gives it", async () => {
    const yellow = { size: CAPTION_SIZES.largest, colour: CAPTION_COLOURS.yellow }
    spies.push(spyOn(api, 'getCaptionStyle').mockImplementation(async () => yellow))
    const fake = fakePlayer()
    renderNative({ player: fake.player, file: { media: mediaItem(), api } })
    await waitFor(() =>
      expect(fake.sent.at(-1)).toEqual({
        type: 'subtitleStyle',
        style: yellow,
      }),
    )
    expect(usePlayerPrefs.getState().captionStyle).toEqual(yellow)
  })

  it('never sends volume when it is fixed', async () => {
    const fake = fakePlayer()
    renderNative({ player: fake.player, services: servicesFor({ isVolumeFixed: true }) })
    await settled()
    fireEvent.keyDown(window, { key: 'ArrowDown' })
    expect(types(fake.sent)).not.toContain('volume')
  })

  it('does not reload while the host rebuilds the same source', async () => {
    const fake = fakePlayer()
    renderNative({ player: fake.player })
    await settled()
    await userEvent.click(screen.getByRole('button', { name: /Rerender/ }))
    await settled()
    expect(types(fake.sent).filter((type) => type === PLAYER_COMMANDS.load)).toHaveLength(1)
    expect(types(fake.sent)).not.toContain('stop')
  })

  it('sends nothing more when a held load is answered after unmount', async () => {
    const fake = fakePlayer({ deferLoad: true })
    renderNative({ player: fake.player })
    await userEvent.click(screen.getByRole('button', { name: 'Leave' }))
    expect(types(fake.sent)).toEqual(['load', 'stop'])
    fake.answerLoad()
    await settled()
    await fake.emit({ type: 'ended' })
    expect(types(fake.sent)).toEqual(['load', 'stop'])
    expect(screen.queryByText('Next page')).toBeNull()
  })

  it('ignores a load refused after unmount', async () => {
    const fake = fakePlayer({ deferLoad: true })
    renderNative({ player: fake.player })
    await userEvent.click(screen.getByRole('button', { name: 'Leave' }))
    fake.refuseLoad({ message: 'That video is no longer open.' })
    await settled()
    expect(screen.queryByText('That video is no longer open.')).toBeNull()
    expect(types(fake.sent)).toEqual(['load', 'stop'])
  })

  it('stops, then loads a different video from fresh state', async () => {
    const fake = fakePlayer({ deferLoad: true })
    renderNative({ player: fake.player })
    fake.answerLoad()
    await settled()
    await fake.emit({ type: 'duration', duration: 120 })
    await fake.emit({ type: 'time', time: 42 })
    await userEvent.click(screen.getByRole('button', { name: 'Change video' }))
    expect(fake.sent.slice(-2)).toEqual([
      { type: 'stop' },
      {
        type: 'load',
        source: { kind: 'file', fileId: 'f2' },
        start: 0,
        audio: null,
        subtitle: null,
      },
    ])
    expect(screen.getByRole('slider', { name: /seek/i })).toHaveAttribute('aria-valuenow', '0')
    await fake.emit({ type: 'ended' })
    expect(screen.queryByText('Next page')).toBeNull()
    fake.answerLoad()
    await settled()
    await fake.emit({ type: 'ended' })
    expect(await screen.findByText('Next page')).toBeInTheDocument()
  })

  it('ignores the replaced video refusing its load', async () => {
    const fake = fakePlayer({ deferLoad: true })
    renderNative({ player: fake.player })
    await userEvent.click(screen.getByRole('button', { name: 'Change video' }))
    fake.refuseLoad({ index: 0, message: 'The old video went away.' })
    await settled()
    expect(screen.queryByText('The old video went away.')).toBeNull()
  })

  it('falls back to its own words for an empty refusal or error', async () => {
    const refused = fakePlayer({ loadError: new Error('') })
    const { unmount } = renderNative({ player: refused.player })
    await settled()
    expect(screen.getByText('Raven could not open this video.')).toBeInTheDocument()
    unmount()

    const errored = fakePlayer()
    renderNative({ player: errored.player })
    await settled()
    await errored.emit({ type: 'error', reason: 'decode', message: '' })
    expect(screen.getAllByText('Raven could not play this video.')).not.toHaveLength(0)
    expect(screen.getByRole('button', { name: /back/i })).toBeInTheDocument()
  })

  it('warns about a refused command and puts a refused pick back', async () => {
    const warn = spyOn(console, 'warn').mockImplementation(() => {})
    const fake = fakePlayer({ refuse: ['audio', 'stats'] })
    const save = mock(() => {})
    renderNative({
      player: fake.player,
      services: servicesFor({ trackPicks: { start: null, save } }),
    })
    await settled()
    await fake.emit({ type: 'tracks', tracks: TRACKS })
    fireEvent.keyDown(window, { key: 'i' })
    await settled()
    expect(warn).toHaveBeenCalledWith('Raven refused stats: Not now.')
    await userEvent.click(screen.getByRole('button', { name: /^Audio/ }))
    await userEvent.click(await screen.findByRole('radio', { name: /French/ }))
    await settled()
    expect(fake.sent).toContainEqual({ type: 'audio', index: 1 })
    expect(screen.getByRole('radio', { name: /French/ })).not.toBeChecked()
    expect(save).not.toHaveBeenCalled()
    expect(usePlayerPrefs.getState().audioLanguage).toBeNull()
    warn.mockRestore()
  })
})
