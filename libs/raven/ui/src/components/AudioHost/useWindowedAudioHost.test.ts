import {
  type ApiClient,
  EMPTY_QUEUE,
  LIBRARY_KINDS,
  type LibraryKind,
  REMOTE_COMMANDS,
  REPEAT_MODES,
  type Track,
  createApiClient,
} from '@raven/core'
import { QueryClient } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from 'bun:test'
import { act, cleanup, waitFor } from '@testing-library/react'
import { AUDIO_HOST_COPY } from '@/components/AudioHost/copy'
import {
  type WindowedPlayer,
  runRemoteCommand,
  useWindowedAudioHost,
} from '@/components/AudioHost/useWindowedAudioHost'
import type { WatchHide } from '@/components/Player/useProgressReport'
import { queryKeys } from '@/query/queryClient'
import { AUDIO_STATES, useAudioQueue } from '@/stores/audioQueue'
import { library, mediaItem } from '@/test/fixtures'
import { renderQueryHook } from '@/test/renderQueryHook'

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

/** An API whose fetch never answers, so only what a test stubs on it replies. */
const silentApi = (): ApiClient => createApiClient({ fetch: () => new Promise(() => undefined) })

const api = silentApi()

/** A cache that already holds the tracks' library, of `kind`. */
const clientWith = (kind: LibraryKind): QueryClient => {
  const client = new QueryClient()
  client.setQueryData(queryKeys.libraries, [
    library({ id: 1, settings: { ...library().settings, kind } }),
  ])
  return client
}

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
    load: async ({ playing, next, start }) => {
      calls.push(`load ${playing.id} ${next?.id ?? '-'}${start > 0 ? ` at ${start}` : ''}`)
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

/** A host that never hides, as these tests leave the page alone. */
const neverHides: WatchHide = () => () => undefined

type RenderHostProps = { player: WindowedPlayer; client?: QueryClient; hostApi?: ApiClient }

const renderHost = ({
  player,
  client = clientWith(LIBRARY_KINDS.music),
  hostApi = api,
}: RenderHostProps) =>
  renderQueryHook({
    hook: () => useWindowedAudioHost({ api: hostApi, player, watchHide: neverHides }),
    client,
  })

describe('useWindowedAudioHost', () => {
  beforeEach(reset)
  afterEach(() => {
    cleanup()
    mock.restore()
  })

  it('loads the playing track with the next behind it, and only the next when that changes', () => {
    const { calls, player } = fakePlayer()
    renderHost({ player })
    act(() => store().playTracks({ tracks: ALBUM }))
    expect(calls).toEqual(['load 1 2', 'play'])
    act(() => store().remove(1))
    expect(calls.at(-1)).toBe('next 3')
  })

  it('follows the player onto the next track without loading it again', () => {
    const { calls, player } = fakePlayer()
    const { result } = renderHost({ player })
    act(() => store().playTracks({ tracks: ALBUM }))
    act(() => result.current.advanced())
    expect(store().queue.at).toBe(1)
    expect(calls.filter((call) => call.startsWith('load'))).toEqual(['load 1 2'])
    expect(calls).toContain('next 3')
  })

  it('loads the same track again when it ends under repeat one', () => {
    const { calls, player } = fakePlayer()
    const { result } = renderHost({ player })
    act(() => store().playTracks({ tracks: ALBUM }))
    act(() => store().cycleRepeat())
    act(() => store().cycleRepeat())
    expect(store().queue.repeat).toBe(REPEAT_MODES.one)
    act(() => result.current.ended())
    expect(calls.filter((call) => call.startsWith('load 1'))).toHaveLength(2)
  })

  it('stops the player when the queue is cleared, and says why a load failed', async () => {
    const { calls, player } = fakePlayer({ loadFails: new Error('') })
    renderHost({ player })
    await act(async () => store().playTracks({ tracks: ALBUM }))
    expect(store().state).toBe(AUDIO_STATES.failed)
    expect(store().error).toBe(AUDIO_HOST_COPY.couldNotPlay)
    act(() => store().clear())
    expect(calls.at(-1)).toBe('stop')
  })

  it('pauses and seeks as the store asks', () => {
    const { calls, player } = fakePlayer()
    renderHost({ player })
    act(() => store().playTracks({ tracks: ALBUM }))
    act(() => store().engine.state(AUDIO_STATES.playing))
    act(() => store().pause())
    act(() => store().seekTo(42))
    expect(calls.slice(-2)).toEqual(['pause', 'seek 42'])
    expect(store().seek).toBeNull()
  })
})

describe('useWindowedAudioHost and the spot', () => {
  beforeEach(reset)
  afterEach(() => {
    cleanup()
    mock.restore()
  })

  /** An API that answers the track's media with a spot left at 120 of 200 seconds, and keeps each spot saved. */
  const bookApi = () => {
    const saves: number[] = []
    const hostApi = silentApi()
    const media = spyOn(hostApi, 'getMedia').mockResolvedValue(
      mediaItem({ id: 1, position: 120, duration: 200 }),
    )
    spyOn(hostApi, 'saveProgress').mockImplementation(async ({ position }) => {
      saves.push(position)
    })
    return { hostApi, media, saves }
  }

  it('starts music at its top and never saves its spot', () => {
    const { hostApi, media, saves } = bookApi()
    const { calls, player } = fakePlayer()
    renderHost({ player, hostApi })
    act(() => store().playTracks({ tracks: ALBUM }))
    expect(calls[0]).toBe('load 1 2')
    act(() => store().engine.state(AUDIO_STATES.playing))
    act(() => store().engine.time({ position: 60, duration: 200 }))
    act(() => store().pause())
    act(() => store().next())
    expect(media).not.toHaveBeenCalled()
    expect(saves).toEqual([])
  })

  it('loads an audiobook at its saved spot once read, and saves the spot as it plays', async () => {
    const { hostApi, saves } = bookApi()
    const { calls, player } = fakePlayer()
    renderHost({ player, hostApi, client: clientWith(LIBRARY_KINDS.audiobooks) })
    act(() => store().playTracks({ tracks: ALBUM }))
    expect(calls.filter((call) => call.startsWith('load'))).toEqual([])
    await waitFor(() => expect(calls).toContain('load 1 2 at 120'))
    expect(store().position).toBe(120)
    act(() => store().engine.state(AUDIO_STATES.playing))
    act(() => store().engine.time({ position: 125, duration: 200 }))
    expect(saves).toEqual([])
    act(() => store().engine.time({ position: 131, duration: 200 }))
    act(() => store().engine.time({ position: 133, duration: 200 }))
    act(() => store().pause())
    act(() => store().engine.state(AUDIO_STATES.paused))
    await waitFor(() => expect(saves).toEqual([131, 133]))
    act(() => store().engine.time({ position: 135, duration: 200 }))
    act(() => store().clear())
    await waitFor(() => expect(saves).toEqual([131, 133, 135]))
  })

  it('plays a book from its top again under repeat one', async () => {
    const { hostApi } = bookApi()
    const { calls, player } = fakePlayer()
    const { result } = renderHost({
      player,
      hostApi,
      client: clientWith(LIBRARY_KINDS.audiobooks),
    })
    act(() => store().playTracks({ tracks: ALBUM }))
    await waitFor(() => expect(calls).toContain('load 1 2 at 120'))
    act(() => store().cycleRepeat())
    act(() => store().cycleRepeat())
    act(() => result.current.ended())
    expect(calls.filter((call) => call.startsWith('load 1'))).toEqual([
      'load 1 2 at 120',
      'load 1 -',
    ])
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
