import { type ApiClient, type Track, createApiClient } from '@raven/core'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, jest, spyOn } from 'bun:test'
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { AudioHost, LISTEN_AFTER_S, listenPointOf } from '@/components/AudioHost/AudioHost'
import { AUDIO_STATES, useAudioQueue } from '@/stores/audioQueue'
import { useMediaOrigin } from '@/stores/mediaOrigin'

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

const renderHost = (api: ApiClient) =>
  render(
    <QueryClientProvider client={new QueryClient()}>
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
    renderHost(apiWith([]))
    act(() => store().playTracks({ tracks: ALBUM }))
    const [current, preload] = audioElements()
    expect(current?.src).toContain('/api/media/1/file')
    expect(preload?.src).toContain('/api/media/2/file')
    expect(played).toHaveLength(1)
  })

  it('follows the element: playing, pausing, time, the end, and a failure', () => {
    renderHost(apiWith([]))
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
    renderHost(apiWith([]))
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
    renderHost(apiWith(plays))
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
    renderHost(api)
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
    renderHost(api)
    act(() => store().playTracks({ tracks: [track(3)] }))
    await waitFor(() =>
      expect(audioElements()[0]?.src).toContain('http://nas.local:8484/api/media/3/file'),
    )
    expect(audioElements()[0]?.src).toContain('t=tkt')
  })

  it('unloads the element once the queue is cleared', () => {
    renderHost(apiWith([]))
    act(() => store().playTracks({ tracks: ALBUM }))
    act(() => store().clear())
    const [current] = audioElements()
    expect(current?.getAttribute('src')).toBeNull()
    expect(audioElements()).toHaveLength(1)
  })
})
