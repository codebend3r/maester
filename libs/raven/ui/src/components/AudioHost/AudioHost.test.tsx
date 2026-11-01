import {
  type ApiClient,
  LIBRARY_KINDS,
  type LibraryKind,
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
import { usePlayerPrefs } from '@/stores/playerPrefs'
import { queryKeys } from '@/query/queryClient'
import { library, mediaItem } from '@/test/fixtures'

const track = (id: number): Track => ({
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
})

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
    const [current] = audioElements()
    expect(current?.getAttribute('src')).toBeNull()
    expect(HTMLMediaElement.prototype.pause).toHaveBeenCalled()
    expect(store().state).toBe(AUDIO_STATES.empty)
    expect(audioElements()).toHaveLength(1)
  })
})
