import {
  type ApiClient,
  EQ_PRESETS,
  EQ_PRESET_NAMES,
  FLAT_EQUALIZER,
  LEVELLING_MODES,
  LIBRARY_KINDS,
  type LibraryKind,
  REPEAT_MODES,
  type Track,
  createApiClient,
} from '@raven/core'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, jest, spyOn } from 'bun:test'
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { AudioHost } from '@/components/AudioHost/AudioHost'
import { LISTEN_AFTER_S, listenPointOf } from '@/components/AudioHost/useListenCounter'
import { AUDIO_STATES, useAudioQueue } from '@/stores/audioQueue'
import { useMediaOrigin } from '@/stores/mediaOrigin'
import { MUSIC_QUALITIES, usePlayerPrefs } from '@/stores/playerPrefs'
import { fakeContexts, installAudioContext, removeAudioContext } from '@/test/fakeAudioContext'
import { queryKeys } from '@/query/queryClient'
import { library, mediaItem } from '@/test/fixtures'

const NO_GAIN: Track['gain'] = { track: null, album: null, trackPeak: null, albumPeak: null }

type GainedTrackProps = { id: number; gain?: Track['gain'] }

const gainedTrack = ({ id, gain = NO_GAIN }: GainedTrackProps): Track => ({
  id,
  libraryId: 1,
  albumId: 7,
  title: `Track ${id}`,
  disc: 1,
  number: id,
  duration: 200,
  artists: [{ id: 1, name: 'Radiohead' }],
  container: 'flac',
  codec: 'flac',
  bitrate: 900000,
  sampleRate: 44100,
  bitDepth: 16,
  isLossless: true,
  mbid: null,
  addedAt: '2026-01-01T00:00:00Z',
  album: { title: 'OK Computer', coverVersion: 'v1' },
  gain,
})

const track = (id: number): Track => gainedTrack({ id })

const ALBUM = [track(1), track(2)]

/** An API whose plays are counted and whose fetch never runs. */
const apiWith = (plays: number[]): ApiClient => {
  const api = createApiClient({ fetch: () => new Promise(() => undefined) })
  spyOn(api, 'recordPlay').mockImplementation(async (id: number) => {
    plays.push(id)
  })
  return api
}

/** A cache that already holds the tracks' library, of `kind`, so a track need not wait to learn it. */
const clientWith = (kind: LibraryKind): QueryClient => {
  const client = new QueryClient()
  client.setQueryData(queryKeys.libraries, [
    library({ id: 1, settings: { ...library().settings, kind } }),
  ])
  return client
}

type RenderHostProps = { api: ApiClient; client?: QueryClient }

const renderHost = ({ api, client = clientWith(LIBRARY_KINDS.music) }: RenderHostProps) =>
  render(
    <QueryClientProvider client={client}>
      <AudioHost api={api} reprobe={() => undefined} />
    </QueryClientProvider>,
  )

const audioElements = (): HTMLAudioElement[] => Array.from(document.querySelectorAll('audio'))

const store = () => useAudioQueue.getState()

describe('listenPointOf', () => {
  it('is halfway, or four minutes, whichever comes first', () => {
    expect(listenPointOf(200)).toBe(100)
    expect(listenPointOf(1000)).toBe(LISTEN_AFTER_S)
    expect(listenPointOf(null)).toBeNull()
  })
})

describe('AudioHost', () => {
  const played: string[] = []

  beforeEach(() => {
    played.length = 0
    store().clear()
    useMediaOrigin.setState({ pick: null })
    spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(function play(
      this: HTMLMediaElement,
    ) {
      played.push(this.src)
      return Promise.resolve()
    })
    spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined)
    spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => undefined)
  })

  afterEach(() => {
    cleanup()
    jest.restoreAllMocks()
  })

  it('plays the queued track from the server and preloads the next', () => {
    renderHost({ api: apiWith([]) })
    act(() => store().playTracks({ tracks: ALBUM }))
    const [current, preload] = audioElements()
    expect(current?.src).toContain('/api/media/1/file')
    expect(preload?.src).toContain('/api/media/2/file')
    expect(played).toHaveLength(1)
  })

  it('follows the element: playing, pausing, time, the end, and a failure', () => {
    renderHost({ api: apiWith([]) })
    act(() => store().playTracks({ tracks: ALBUM }))
    const [current] = audioElements()
    if (!current) throw new Error('No audio element')
    act(() => fireEvent(current, new Event('playing')))
    expect(store().state).toBe(AUDIO_STATES.playing)
    act(() => fireEvent(current, new Event('pause')))
    expect(store().state).toBe(AUDIO_STATES.paused)
    act(() => fireEvent(current, new Event('ended')))
    expect(store().queue.at).toBe(1)
    act(() => fireEvent(current, new Event('error')))
    expect(store().state).toBe(AUDIO_STATES.failed)
    expect(store().error).toBe('Playback stopped unexpectedly.')
  })

  it('pauses and plays the element as the store says, and seeks once per request', () => {
    renderHost({ api: apiWith([]) })
    act(() => store().playTracks({ tracks: ALBUM }))
    const [current] = audioElements()
    if (!current) throw new Error('No audio element')
    act(() => store().engine.state(AUDIO_STATES.playing))
    act(() => store().pause())
    expect(HTMLMediaElement.prototype.pause).toHaveBeenCalled()
    act(() => store().play())
    expect(played.length).toBeGreaterThanOrEqual(2)
    act(() => store().seekTo(42))
    expect(current.currentTime).toBe(42)
    expect(store().seek).toBeNull()
  })

  it('counts a listen once a track is half played, once per track', () => {
    const plays: number[] = []
    renderHost({ api: apiWith(plays) })
    act(() => store().playTracks({ tracks: ALBUM }))
    act(() => store().engine.time({ position: 50, duration: 200 }))
    expect(plays).toEqual([])
    act(() => store().engine.time({ position: 101, duration: 200 }))
    act(() => store().engine.time({ position: 150, duration: 200 }))
    expect(plays).toEqual([1])
    act(() => store().engine.ended())
    act(() => store().engine.time({ position: 101, duration: 200 }))
    expect(plays).toEqual([1, 2])
  })

  it('keeps the element on the track once its address changes with a renewed ticket', async () => {
    const api = apiWith([])
    const tickets = ['first', 'second']
    spyOn(api, 'getMediaTicket').mockImplementation(async () => ({
      ticket: tickets.shift() ?? 'later',
      expiresAt: Date.now() + 300_000,
    }))
    useMediaOrigin.setState({
      pick: { origin: { kind: 'lan', url: 'http://nas.local:8484' }, at: Date.now() },
    })
    renderHost({ api })
    act(() => store().playTracks({ tracks: [track(3)] }))
    await waitFor(() => expect(audioElements()[0]?.src).toContain('t=first'))
    expect(played).toHaveLength(1)
  })

  it('plays through the picked media origin once its ticket comes', async () => {
    const api = apiWith([])
    spyOn(api, 'getMediaTicket').mockResolvedValue({
      ticket: 'tkt',
      expiresAt: Date.now() + 300_000,
    })
    useMediaOrigin.setState({
      pick: { origin: { kind: 'lan', url: 'http://nas.local:8484' }, at: Date.now() },
    })
    renderHost({ api })
    act(() => store().playTracks({ tracks: [track(3)] }))
    await waitFor(() =>
      expect(audioElements()[0]?.src).toContain('http://nas.local:8484/api/media/3/file'),
    )
    expect(audioElements()[0]?.src).toContain('t=tkt')
  })

  it("plays an audiobook at the prefs' speed and music at its own", async () => {
    usePlayerPrefs.getState().setAudiobookSpeed(1.5)
    const client = new QueryClient()
    client.setQueryData(queryKeys.libraries, [
      library({ id: 1, settings: { ...library().settings, kind: LIBRARY_KINDS.audiobooks } }),
    ])
    renderHost({ api: apiWith([]), client })
    act(() => store().playTracks({ tracks: ALBUM }))
    await waitFor(() => expect(audioElements()[0]?.playbackRate ?? null).toBe(1.5))
    expect(audioElements()[0]?.defaultPlaybackRate ?? null).toBe(1.5)
    act(() =>
      client.setQueryData(queryKeys.libraries, [
        library({ id: 1, settings: { ...library().settings, kind: LIBRARY_KINDS.music } }),
      ]),
    )
    await waitFor(() => expect(audioElements()[0]?.playbackRate ?? null).toBe(1))
    usePlayerPrefs.getState().setAudiobookSpeed(1)
  })

  it('starts an audiobook where it was left and saves its spot; music saves none', async () => {
    const saves: number[] = []
    const api = apiWith([])
    spyOn(api, 'getMedia').mockResolvedValue(mediaItem({ id: 1, position: 120, duration: 200 }))
    spyOn(api, 'saveProgress').mockImplementation(async ({ position }) => {
      saves.push(position)
    })
    renderHost({ api, client: clientWith(LIBRARY_KINDS.audiobooks) })
    act(() => store().playTracks({ tracks: ALBUM }))
    expect(played).toEqual([])
    await waitFor(() => expect(played).toHaveLength(1))
    const [current] = audioElements()
    if (!current) throw new Error('No audio element')
    expect(current.currentTime).toBe(120)
    expect(store().position).toBe(120)
    fireEvent.playing(current)
    current.currentTime = 135
    fireEvent.timeUpdate(current)
    fireEvent.pause(current)
    await waitFor(() => expect(saves).toEqual([135, 135]))
    cleanup()
    saves.length = 0
    renderHost({ api })
    act(() => store().playTracks({ tracks: ALBUM }))
    const [music] = audioElements()
    if (!music) throw new Error('No audio element')
    fireEvent.playing(music)
    music.currentTime = 60
    fireEvent.timeUpdate(music)
    fireEvent.pause(music)
    act(() => store().clear())
    expect(saves).toEqual([])
  })

  it('unloads the element once the queue is cleared', () => {
    renderHost({ api: apiWith([]) })
    act(() => store().playTracks({ tracks: ALBUM }))
    act(() => store().clear())
    const [current, preload] = audioElements()
    expect(current?.getAttribute('src')).toBeNull()
    expect(preload?.getAttribute('src')).toBeNull()
    expect(HTMLMediaElement.prototype.pause).toHaveBeenCalled()
    expect(store().state).toBe(AUDIO_STATES.empty)
  })
})

describe('AudioHost sound', () => {
  const played: HTMLMediaElement[] = []
  const paused: HTMLMediaElement[] = []

  beforeEach(() => {
    played.length = 0
    paused.length = 0
    store().clear()
    useMediaOrigin.setState({ pick: null })
    spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(function play(
      this: HTMLMediaElement,
    ) {
      played.push(this)
      return Promise.resolve()
    })
    spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(function pause(
      this: HTMLMediaElement,
    ) {
      paused.push(this)
    })
    spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => undefined)
  })

  afterEach(() => {
    cleanup()
    jest.restoreAllMocks()
    removeAudioContext()
    usePlayerPrefs.setState({
      volume: 1,
      musicQuality: MUSIC_QUALITIES.original,
      levelling: LEVELLING_MODES.album,
      crossfade: 0,
      equalizer: FLAT_EQUALIZER,
    })
    store().clear()
  })

  type PlayAtProps = { element: HTMLMediaElement; seconds: number; duration?: number }

  /** Puts `element` `seconds` into a track of `duration` and says so, as a browser's clock would. */
  const playAt = ({ element, seconds, duration = 200 }: PlayAtProps) => {
    Object.defineProperty(element, 'duration', { value: duration, configurable: true })
    element.currentTime = seconds
    act(() => fireEvent.timeUpdate(element))
  }

  const bothElements = (): [HTMLAudioElement, HTMLAudioElement] => {
    const [first, second] = audioElements()
    if (!first || !second) throw new Error('No audio elements')
    return [first, second]
  }

  it('plays music from an AAC transcode at the bitrate the prefs pick, and audiobooks from their file', async () => {
    usePlayerPrefs.getState().setMusicQuality(MUSIC_QUALITIES.standard)
    renderHost({ api: apiWith([]) })
    act(() => store().playTracks({ tracks: ALBUM }))
    const [current, preload] = bothElements()
    expect(current.src).toContain('/api/media/1/transcode?kbps=256')
    expect(preload.src).toContain('/api/media/2/transcode?kbps=256')
    cleanup()
    const api = apiWith([])
    spyOn(api, 'getMedia').mockResolvedValue(mediaItem({ id: 4, position: 0, duration: 200 }))
    renderHost({ api, client: clientWith(LIBRARY_KINDS.audiobooks) })
    act(() => store().playTracks({ tracks: [track(4)] }))
    await waitFor(() => expect(audioElements()[0]?.src).toContain('/api/media/4/file'))
  })

  it("levels each track's volume by its album gain, and leaves it be with levelling off", () => {
    usePlayerPrefs.getState().setVolume({ volume: 0.8, muted: false })
    renderHost({ api: apiWith([]) })
    const quiet = gainedTrack({ id: 5, gain: { ...NO_GAIN, album: -6, track: -3 } })
    act(() => store().playTracks({ tracks: [quiet, track(6)] }))
    const [current, preload] = bothElements()
    expect(current.volume).toBeCloseTo(0.8 * 0.501, 3)
    expect(preload.volume).toBe(0.8)
    act(() => usePlayerPrefs.getState().setLevelling(LEVELLING_MODES.off))
    expect(current.volume).toBe(0.8)
  })

  it('routes nothing through Web Audio while the equalizer is flat and crossfade is off', () => {
    installAudioContext()
    renderHost({ api: apiWith([]) })
    act(() => store().playTracks({ tracks: ALBUM }))
    act(() => fireEvent(bothElements()[0], new Event('ended')))
    expect(fakeContexts()).toHaveLength(0)
    expect(bothElements().map((element) => element.getAttribute('crossorigin'))).toEqual([
      null,
      null,
    ])
  })

  it('equalises through ten bands once a preset is picked, reloading the playing track with CORS where it was', () => {
    installAudioContext()
    renderHost({ api: apiWith([]) })
    act(() => store().playTracks({ tracks: ALBUM }))
    const [current] = bothElements()
    current.currentTime = 30
    act(() =>
      usePlayerPrefs
        .getState()
        .setEqualizer({ preset: EQ_PRESET_NAMES.vocal, gains: EQ_PRESETS.vocal }),
    )
    expect(current.crossOrigin).toBe('anonymous')
    expect(current.currentTime).toBe(30)
    const [context] = fakeContexts()
    expect(context?.filters.map((filter) => filter.gain.value)).toEqual([...EQ_PRESETS.vocal])
    expect(context?.resumes).toBeGreaterThanOrEqual(1)
    act(() => usePlayerPrefs.getState().setEqualizer(FLAT_EQUALIZER))
    expect(context?.filters.every((filter) => filter.gain.value === 0)).toBe(true)
    expect(fakeContexts()).toHaveLength(1)
  })

  it('resumes a context left suspended on the next gesture', () => {
    installAudioContext()
    usePlayerPrefs
      .getState()
      .setEqualizer({ preset: EQ_PRESET_NAMES.bassBoost, gains: EQ_PRESETS.bassBoost })
    renderHost({ api: apiWith([]) })
    act(() => store().playTracks({ tracks: ALBUM }))
    const [context] = fakeContexts()
    if (!context) throw new Error('No audio context')
    context.state = 'suspended'
    const resumes = context.resumes
    fireEvent.pointerDown(document)
    expect(context.resumes).toBe(resumes + 1)
    fireEvent.pointerDown(document)
    expect(context.resumes).toBe(resumes + 1)
  })

  it('swaps tracks on the one element at the end with crossfade off', () => {
    installAudioContext()
    usePlayerPrefs
      .getState()
      .setEqualizer({ preset: EQ_PRESET_NAMES.bassBoost, gains: EQ_PRESETS.bassBoost })
    renderHost({ api: apiWith([]) })
    act(() => store().playTracks({ tracks: ALBUM }))
    const [current, preload] = bothElements()
    playAt({ element: current, seconds: 195 })
    expect(played).not.toContain(preload)
    act(() => fireEvent(current, new Event('ended')))
    expect(store().queue.at).toBe(1)
    expect(current.src).toContain('/api/media/2/file')
    expect(played.at(-1)).toBe(current)
  })

  it('starts the next track at duration - 6 and ramps the gains, advancing the queue once', () => {
    installAudioContext()
    usePlayerPrefs.getState().setCrossfade(6)
    const plays: number[] = []
    renderHost({ api: apiWith(plays) })
    act(() => store().playTracks({ tracks: [track(1), track(2), track(3)] }))
    const [first, second] = bothElements()
    expect(first.crossOrigin).toBe('anonymous')
    act(() => fireEvent.playing(first))
    playAt({ element: first, seconds: 193.9 })
    expect(played).not.toContain(second)
    playAt({ element: first, seconds: 194 })
    expect(played).toContain(second)
    expect(second.currentTime).toBe(0)
    const [context] = fakeContexts()
    const [outgoing, incoming] = context?.gains ?? []
    expect(outgoing?.gain.ramps).toEqual([{ value: 0, time: 16 }])
    expect(incoming?.gain.ramps).toEqual([{ value: 1, time: 16 }])
    expect(store().queue.at).toBe(0)
    act(() => fireEvent.timeUpdate(second))
    expect(store().position).toBe(194)
    act(() => fireEvent(first, new Event('ended')))
    expect(store().queue.at).toBe(1)
    expect(store().state).toBe(AUDIO_STATES.playing)
    expect(second.src).toContain('/api/media/2/file')
    expect(first.src).toContain('/api/media/3/file')
    second.currentTime = 6
    act(() => fireEvent.timeUpdate(second))
    expect(store().position).toBe(6)
    act(() => fireEvent(first, new Event('ended')))
    expect(store().queue.at).toBe(1)
  })

  it('stops the incoming track when the fade is paused or sought out of', () => {
    installAudioContext()
    usePlayerPrefs.getState().setCrossfade(6)
    renderHost({ api: apiWith([]) })
    act(() => store().playTracks({ tracks: ALBUM }))
    const [first, second] = bothElements()
    act(() => fireEvent.playing(first))
    playAt({ element: first, seconds: 196 })
    expect(played).toContain(second)
    act(() => store().pause())
    expect(paused).toContain(second)
    expect(second.currentTime).toBe(0)
    const [, incoming] = fakeContexts()[0]?.gains ?? []
    expect(incoming?.gain.value).toBe(0)
    act(() => store().play())
    act(() => fireEvent.playing(first))
    played.length = 0
    playAt({ element: first, seconds: 197 })
    expect(played).toContain(second)
    paused.length = 0
    act(() => store().seekTo(20))
    expect(paused).toContain(second)
    expect(first.currentTime).toBe(20)
  })

  it('never fades into an audiobook, which starts at its own spot', () => {
    installAudioContext()
    usePlayerPrefs.getState().setCrossfade(6)
    const client = new QueryClient()
    client.setQueryData(queryKeys.libraries, [
      library({ id: 1, settings: { ...library().settings, kind: LIBRARY_KINDS.music } }),
      library({ id: 2, settings: { ...library().settings, kind: LIBRARY_KINDS.audiobooks } }),
    ])
    renderHost({ api: apiWith([]), client })
    act(() => store().playTracks({ tracks: [track(1), { ...track(2), libraryId: 2 }] }))
    const [first, second] = bothElements()
    act(() => fireEvent.playing(first))
    playAt({ element: first, seconds: 197 })
    expect(played).not.toContain(second)
  })

  it('sets no source until the libraries say whether the track is music', async () => {
    usePlayerPrefs.getState().setMusicQuality(MUSIC_QUALITIES.standard)
    const client = new QueryClient()
    renderHost({ api: apiWith([]), client })
    act(() => store().playTracks({ tracks: ALBUM }))
    const [current] = bothElements()
    expect(current.getAttribute('src')).toBeNull()
    act(() =>
      client.setQueryData(queryKeys.libraries, [
        library({ id: 1, settings: { ...library().settings, kind: LIBRARY_KINDS.music } }),
      ]),
    )
    await waitFor(() => expect(current.src).toContain('/api/media/1/transcode?kbps=256'))
  })

  it('fades into nothing neither on the last track nor on repeat one', () => {
    installAudioContext()
    usePlayerPrefs.getState().setCrossfade(6)
    renderHost({ api: apiWith([]) })
    act(() => store().playTracks({ tracks: [track(1)] }))
    const [first, second] = bothElements()
    act(() => fireEvent.playing(first))
    playAt({ element: first, seconds: 196 })
    expect(played).not.toContain(second)
    act(() => store().playTracks({ tracks: ALBUM }))
    act(() => store().cycleRepeat())
    act(() => store().cycleRepeat())
    expect(store().queue.repeat).toBe(REPEAT_MODES.one)
    act(() => fireEvent.playing(first))
    playAt({ element: first, seconds: 196 })
    expect(played).not.toContain(second)
    act(() => store().cycleRepeat())
  })
})
