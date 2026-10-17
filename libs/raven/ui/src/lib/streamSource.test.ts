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
 * fragment from 4s to 6s on the shifted clock. A third byte marks a chunk
 * that stops partway through its fragment, as network reads do. The
 * parser then takes whatever comes next as the rest of that fragment, so
 * a chunk that does not carry on from it is garbled; only `abort` lets go
 * of the cut-off fragment, and like the real one it throws unless the
 * source is open.
 */
const fakeBuffer = (source: { readyState: string }) => {
  const events = listeners()
  const state: {
    ranges: Array<[number, number]>
    updating: boolean
    appended: number
    /** Where the cut-off fragment the parser holds carries on, if it holds one. */
    cutAt: number | null
  } = {
    ranges: [],
    updating: false,
    appended: 0,
    cutAt: null,
  }
  const finish = (type: 'updateend' | 'error') =>
    queueMicrotask(() => {
      state.updating = false
      events.emit(type)
      if (type === 'error') events.emit('updateend')
    })
  // Appending to or removing from an ended source opens it again.
  const reopen = () => {
    if (source.readyState === 'ended') source.readyState = 'open'
  }
  const buffer: SourceBufferLike = {
    get updating() {
      return state.updating
    },
    get buffered() {
      return rangesFrom(state.ranges)
    },
    appendBuffer: (data) => {
      const [from = 0, to = 0, cut = 0] = data
      reopen()
      state.updating = true
      if (state.cutAt != null && state.cutAt !== from) {
        finish('error')
        return
      }
      const last = state.ranges.at(-1)
      state.ranges =
        last && Math.abs(last[1] - from) < 0.01
          ? [...state.ranges.slice(0, -1), [last[0], to]]
          : [...state.ranges, [from, to]]
      state.appended += 1
      state.cutAt = cut ? to : null
      finish('updateend')
    },
    remove: (start, end) => {
      reopen()
      state.ranges = state.ranges
        .map(([from, to]): [number, number] => [
          from >= start && from < end ? Math.min(to, end) : from,
          to,
        ])
        .filter(([from, to]) => !(from >= start && to <= end) && to > from)
      state.updating = true
      finish('updateend')
    },
    abort: () => {
      if (source.readyState !== 'open') {
        throw new DOMException('The source is not open.', 'InvalidStateError')
      }
      state.updating = false
      state.cutAt = null
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
const setup = ({
  streams = {},
  ok = true,
}: {
  streams?: Record<string, Array<[number, number]>>
  ok?: boolean
} = {}) => {
  const sourceEvents = listeners()
  const sourceState = { readyState: 'closed', ended: 0, duration: NaN, mime: '' }
  const { buffer, state: bufferState } = fakeBuffer(sourceState)
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
      sourceState.readyState = 'ended'
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

/** The URL a test's stream starts at `start` from, the key of its chunks in `setup`. */
const streamUrl = (start: number) => `from-${start}`

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

  it('starts a seek cleanly when it cuts the running stream off partway through a fragment', async () => {
    const video = fakeVideo()
    const { environment, fetched, bufferState } = setup({ streams: { 'from-200': [[199, 203]] } })
    // A whole fragment and the first part of the next, then nothing more yet.
    const stalled: StreamEnvironment = {
      ...environment,
      fetch: async (url, init) => {
        const response = await environment.fetch(url, init)
        if (url !== 'from-0') return response
        return {
          ...response,
          body: new ReadableStream({
            start: (controller) => {
              controller.enqueue(new Uint8Array([1, 3]))
              controller.enqueue(new Uint8Array([3, 4, 1]))
            },
          }),
        }
      },
    }
    const errors: string[] = []
    createStreamSession({
      video,
      mime: 'video/mp4',
      duration: 600,
      start: 0,
      url: (start) => `from-${start}`,
      onError: (message) => errors.push(message),
      environment: stalled,
    })
    await settle()
    video.currentTime = 201
    await settle()
    expect(fetched).toEqual(['from-0', 'from-200'])
    expect(errors).toEqual([])
    expect(bufferState.ranges).toEqual([[199, 203]])
  })

  it('waits for a running stream to reach a seek just past its edge', async () => {
    const video = fakeVideo()
    const never = new Promise<never>(() => {})
    const { environment, fetched } = setup()
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
    const { environment } = setup({ ok: false })
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

  it('says the origin is unreachable when the fetch rejects, then fails', async () => {
    const calls: string[] = []
    createStreamSession({
      video: fakeVideo(),
      mime: 'video/mp4',
      duration: null,
      start: 0,
      url: () => 'x',
      onError: (message) => calls.push(`error: ${message}`),
      onUnreachable: () => calls.push('unreachable'),
      environment: {
        ...setup().environment,
        fetch: async () => {
          throw new TypeError('Failed to fetch')
        },
      },
    })
    await settle()
    expect(calls).toEqual(['unreachable', 'error: Failed to fetch'])
  })

  it('does not call a server that answers with an error unreachable', async () => {
    const calls: string[] = []
    createStreamSession({
      video: fakeVideo(),
      mime: 'video/mp4',
      duration: null,
      start: 0,
      url: () => 'x',
      onError: (message) => calls.push(`error: ${message}`),
      onUnreachable: () => calls.push('unreachable'),
      environment: setup({ ok: false }).environment,
    })
    await settle()
    expect(calls).toEqual(['error: The server could not convert this video (500).'])
  })

  it('does not call an origin unreachable once it has delivered a chunk', async () => {
    const calls: string[] = []
    const base = setup()
    createStreamSession({
      video: fakeVideo(),
      mime: 'video/mp4',
      duration: null,
      start: 0,
      url: () => 'x',
      onError: (message) => calls.push(`error: ${message}`),
      onUnreachable: () => calls.push('unreachable'),
      environment: {
        ...base.environment,
        fetch: async () => ({
          ok: true,
          status: 200,
          // Nothing is pulled ahead of a read, so the error comes after the append.
          body: new ReadableStream<Uint8Array<ArrayBuffer>>(
            {
              pull: (controller) => {
                if (base.bufferState.appended > 0) {
                  controller.error(new TypeError('network error'))
                  return
                }
                controller.enqueue(new Uint8Array([0, 2]))
              },
            },
            { highWaterMark: 0 },
          ),
        }),
      },
    })
    await settle()
    expect(base.bufferState.appended).toBe(1)
    expect(calls).toEqual(['error: network error'])
  })

  it('ignores an aborted fetch', async () => {
    const calls: string[] = []
    createStreamSession({
      video: fakeVideo(),
      mime: 'video/mp4',
      duration: null,
      start: 0,
      url: () => 'x',
      onError: (message) => calls.push(`error: ${message}`),
      onUnreachable: () => calls.push('unreachable'),
      environment: {
        ...setup().environment,
        fetch: async () => {
          throw new DOMException('aborted', 'AbortError')
        },
      },
    })
    await settle()
    expect(calls).toEqual([])
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
      environment: { ...setup().environment, createMediaSource: () => null },
    })
    await settle()
    expect(errors).toEqual(["This browser can't play converted video."])
  })

  it('stops and stays quiet once destroyed', async () => {
    const video = fakeVideo()
    const { environment, fetched } = setup({ ok: false })
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
