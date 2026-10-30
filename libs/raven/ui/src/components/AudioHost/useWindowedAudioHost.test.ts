import {
  EMPTY_QUEUE,
  REMOTE_COMMANDS,
  REPEAT_MODES,
  type Track,
  createApiClient,
} from '@raven/core'
import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { act, cleanup, renderHook } from '@testing-library/react'
import {
  COULD_NOT_PLAY,
  type WindowedPlayer,
  runRemoteCommand,
  useWindowedAudioHost,
} from '@/components/AudioHost/useWindowedAudioHost'
import { AUDIO_STATES, useAudioQueue } from '@/stores/audioQueue'

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

const ALBUM = [track(1), track(2), track(3)]

const api = createApiClient({ fetch: () => new Promise(() => undefined) })

const store = () => useAudioQueue.getState()

/** An empty queue with repeat off, since `clear` keeps the repeat a test before set. */
const reset = () => {
  store().clear()
  useAudioQueue.setState({ queue: EMPTY_QUEUE })
}

type FakePlayerProps = { loadFails?: Error | null }

/** A player that writes down each call as a line, so a test reads what the host asked of it. */
const fakePlayer = ({ loadFails = null }: FakePlayerProps = {}) => {
  const calls: string[] = []
  const player: WindowedPlayer = {
    load: async ({ playing, next }) => {
      calls.push(`load ${playing.id} ${next?.id ?? '-'}`)
      if (loadFails !== null) throw loadFails
    },
    queueNext: async (next) => {
      calls.push(`next ${next?.id ?? '-'}`)
    },
    stop: async () => {
      calls.push('stop')
    },
    setPlaying: async ({ shouldPlay }) => {
      calls.push(shouldPlay ? 'play' : 'pause')
    },
    seek: async (seconds) => {
      calls.push(`seek ${seconds}`)
    },
    setVolume: async () => undefined,
  }
  return { calls, player }
}

const renderHost = (player: WindowedPlayer) =>
  renderHook(() => useWindowedAudioHost({ api, player }))

describe('useWindowedAudioHost', () => {
  beforeEach(reset)
  afterEach(() => cleanup())

  it('loads the playing track with the next behind it, and only the next when that changes', () => {
    const { calls, player } = fakePlayer()
    renderHost(player)
    act(() => store().playTracks({ tracks: ALBUM }))
    expect(calls).toEqual(['load 1 2', 'play'])
    act(() => store().remove(1))
    expect(calls.at(-1)).toBe('next 3')
  })

  it('follows the player onto the next track without loading it again', () => {
    const { calls, player } = fakePlayer()
    const { result } = renderHost(player)
    act(() => store().playTracks({ tracks: ALBUM }))
    act(() => result.current.advanced())
    expect(store().queue.at).toBe(1)
    expect(calls.filter((call) => call.startsWith('load'))).toEqual(['load 1 2'])
    expect(calls).toContain('next 3')
  })

  it('loads the same track again when it ends under repeat one', () => {
    const { calls, player } = fakePlayer()
    const { result } = renderHost(player)
    act(() => store().playTracks({ tracks: ALBUM }))
    act(() => store().cycleRepeat())
    act(() => store().cycleRepeat())
    expect(store().queue.repeat).toBe(REPEAT_MODES.one)
    act(() => result.current.ended())
    expect(calls.filter((call) => call.startsWith('load 1'))).toHaveLength(2)
  })

  it('stops the player when the queue is cleared, and says why a load failed', async () => {
    const { calls, player } = fakePlayer({ loadFails: new Error('') })
    renderHost(player)
    await act(async () => store().playTracks({ tracks: ALBUM }))
    expect(store().state).toBe(AUDIO_STATES.failed)
    expect(store().error).toBe(COULD_NOT_PLAY)
    act(() => store().clear())
    expect(calls.at(-1)).toBe('stop')
  })

  it('pauses and seeks as the store asks', () => {
    const { calls, player } = fakePlayer()
    renderHost(player)
    act(() => store().playTracks({ tracks: ALBUM }))
    act(() => store().engine.state(AUDIO_STATES.playing))
    act(() => store().pause())
    act(() => store().seekTo(42))
    expect(calls.slice(-2)).toEqual(['pause', 'seek 42'])
    expect(store().seek).toBeNull()
  })
})

describe('runRemoteCommand', () => {
  beforeEach(reset)

  it('drives the queue store', () => {
    store().playTracks({ tracks: ALBUM })
    runRemoteCommand({ kind: REMOTE_COMMANDS.next })
    expect(store().queue.at).toBe(1)
    store().engine.state(AUDIO_STATES.playing)
    runRemoteCommand({ kind: REMOTE_COMMANDS.pause })
    expect(store().state).toBe(AUDIO_STATES.paused)
    runRemoteCommand({ kind: REMOTE_COMMANDS.stop })
    expect(store().state).toBe(AUDIO_STATES.empty)
  })
})
