import { describe, expect, it } from 'bun:test'
import {
  type MediaSourceLike,
  type SourceBufferLike,
  type StreamEnvironment,
  type VideoLike,
  createStreamSession,
} from '@/lib/streamSource'

type Listener = () => void

/** addEventListener and friends over a plain map, for the fakes below. */
const listeners = () => {
  const map = new Map<string, Set<Listener>>()
  return {
    addEventListener: (type: string, listener: Listener) => {
      map.set(type, new Set([...(map.get(type) ?? []), listener]))
    },
    removeEventListener: (type: string, listener: Listener) => {
      map.get(type)?.delete(listener)
    },
    emit: (type: string) => [...(map.get(type) ?? [])].forEach((listener) => listener()),
  }
}

const rangesFrom = (ranges: Array<[number, number]>) => ({
  length: ranges.length,
  start: (index: number) => ranges[index]?.[0] ?? 0,
  end: (index: number) => ranges[index]?.[1] ?? 0,
})

/**
 * Each chunk is two bytes, the stream times it covers: [4, 6] is the
 * fragment from 4s to 6s on the shifted clock.
 */
const fakeBuffer = () => {
  const events = listeners()
  const state = { ranges: [] as Array<[number, number]>, updating: false, appended: 0 }
  const finish = () =>
    queueMicrotask(() => {
      state.updating = false
      events.emit('updateend')
    })
  const buffer: SourceBufferLike = {
    get updating() {
      return state.updating
    },
    get buffered() {
      return rangesFrom(state.ranges)
    },
    appendBuffer: (data) => {
      const [from = 0, to = 0] = data
      const last = state.ranges.at(-1)
      state.ranges =
        last && Math.abs(last[1] - from) < 0.01
          ? [...state.ranges.slice(0, -1), [last[0], to]]
          : [...state.ranges, [from, to]]
      state.appended += 1
      state.updating = true
      finish()
    },
    remove: (start, end) => {
      state.ranges = state.ranges
        .map(([from, to]): [number, number] => [
          from >= start && from < end ? Math.min(to, end) : from,
          to,
        ])
        .filter(([from, to]) => !(from >= start && to <= end) && to > from)
      state.updating = true
      finish()
    },
    abort: () => {
      state.updating = false
    },
    addEventListener: events.addEventListener,
    removeEventListener: events.removeEventListener,
  }
  return { buffer, state }
}

const fakeVideo = () => {
  const events = listeners()
  const state = { time: 0 }
  const video: VideoLike & { emit: (type: string) => void } = {
    get currentTime() {
      return state.time
    },
    set currentTime(time: number) {
      state.time = time
      queueMicrotask(() => events.emit('seeking'))
    },
    buffered: rangesFrom([]),
    addEventListener: events.addEventListener,
    removeEventListener: events.removeEventListener,
    emit: events.emit,
  }
  return video
}

/** Responses by start time; each is a list of [from, to] chunks. */
const setup = (streams: Record<string, Array<[number, number]>>, ok = true) => {
  const { buffer, state: bufferState } = fakeBuffer()
  const sourceEvents = listeners()
  const sourceState = { readyState: 'closed', ended: 0, duration: NaN, mime: '' }
  const source: MediaSourceLike = {
    get readyState() {
      return sourceState.readyState
    },
    get duration() {
      return sourceState.duration
    },
    set duration(value: number) {
      sourceState.duration = value
    },
    addSourceBuffer: (mime) => {
      sourceState.mime = mime
      return buffer
    },
    endOfStream: () => {
      sourceState.ended += 1
    },
    addEventListener: sourceEvents.addEventListener,
    removeEventListener: sourceEvents.removeEventListener,
  }
  const fetched: string[] = []
  const aborted: string[] = []
  const environment: StreamEnvironment = {
    createMediaSource: () => source,
    attach: () => {
      queueMicrotask(() => {
        sourceState.readyState = 'open'
        sourceEvents.emit('sourceopen')
      })
      return () => {}
    },
    fetch: async (url, { signal }) => {
      fetched.push(url)
      signal.addEventListener('abort', () => aborted.push(url))
      const chunks = streams[url] ?? []
      return {
        ok,
        status: ok ? 200 : 500,
        body: new ReadableStream({
          start: (controller) => {
            chunks.forEach((chunk) => controller.enqueue(new Uint8Array(chunk)))
            controller.close()
          },
        }),
      }
    },
  }
  return { environment, bufferState, sourceState, fetched, aborted }
}

const settle = async () => {
  await Promise.all(
    Array.from({ length: 5 }, () => new Promise((resolve) => setTimeout(resolve, 0))),
  )
}

describe('createStreamSession', () => {
  it('streams from the start point onto the shifted clock and ends the stream', async () => {
    const video = fakeVideo()
    const { environment, bufferState, sourceState, fetched } = setup({
      'from-120': [
        [119, 121],
        [121, 123],
      ],
    })
    const errors: string[] = []
    createStreamSession({
      video,
      mime: 'video/mp4; codecs="avc1.640028,mp4a.40.2"',
      duration: 600,
      start: 120,
      url: (start) => `from-${start}`,
      onError: (message) => errors.push(message),
      environment,
    })
    await settle()
    expect(fetched).toEqual(['from-120'])
    expect(video.currentTime).toBe(121)
    expect(sourceState.duration).toBe(601)
    expect(sourceState.mime).toContain('avc1')
    expect(bufferState.ranges).toEqual([[119, 123]])
    expect(sourceState.ended).toBe(1)
    expect(errors).toEqual([])
  })

  it('lets the browser seek inside what is buffered, and restarts outside it', async () => {
    const video = fakeVideo()
    const { environment, fetched, bufferState } = setup({
      'from-0': [[1, 31]],
      'from-200': [[199, 203]],
    })
    createStreamSession({
      video,
      mime: 'video/mp4',
      duration: 600,
      start: 0,
      url: (start) => `from-${start}`,
      onError: () => {},
      environment,
    })
    await settle()
    video.currentTime = 11
    await settle()
    expect(fetched).toEqual(['from-0'])

    video.currentTime = 201
    await settle()
    expect(fetched).toEqual(['from-0', 'from-200'])
    expect(bufferState.ranges).toEqual([[199, 203]])
  })

  it('waits for a running stream to reach a seek just past its edge', async () => {
    const video = fakeVideo()
    const never = new Promise<never>(() => {})
    const { environment, fetched } = setup({})
    const slow: StreamEnvironment = {
      ...environment,
      fetch: async (url, init) => {
        await environment.fetch(url, init)
        return {
          ok: true,
          status: 200,
          body: new ReadableStream({ pull: () => never }),
        }
      },
    }
    createStreamSession({
      video,
      mime: 'video/mp4',
      duration: 600,
      start: 40,
      url: (start) => `from-${start}`,
      onError: () => {},
      environment: slow,
    })
    await settle()
    video.currentTime = 46
    await settle()
    expect(fetched).toEqual(['from-40'])
  })

  it('reports a stream the server could not make', async () => {
    const video = fakeVideo()
    const { environment } = setup({}, false)
    const errors: string[] = []
    createStreamSession({
      video,
      mime: 'video/mp4',
      duration: null,
      start: 0,
      url: () => 'x',
      onError: (message) => errors.push(message),
      environment,
    })
    await settle()
    expect(errors).toEqual(['The server could not convert this video (500).'])
  })

  it('reports a browser without Media Source Extensions', async () => {
    const errors: string[] = []
    createStreamSession({
      video: fakeVideo(),
      mime: 'video/mp4',
      duration: null,
      start: 0,
      url: () => 'x',
      onError: (message) => errors.push(message),
      environment: { ...setup({}).environment, createMediaSource: () => null },
    })
    await settle()
    expect(errors).toEqual(["This browser can't play converted video."])
  })

  it('stops and stays quiet once destroyed', async () => {
    const video = fakeVideo()
    const { environment, fetched } = setup({}, false)
    const errors: string[] = []
    const session = createStreamSession({
      video,
      mime: 'video/mp4',
      duration: null,
      start: 0,
      url: () => 'x',
      onError: (message) => errors.push(message),
      environment,
    })
    session.destroy()
    await settle()
    expect(fetched).toEqual([])
    expect(errors).toEqual([])
  })
})
