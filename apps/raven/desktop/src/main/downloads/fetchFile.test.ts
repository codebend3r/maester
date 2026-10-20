import { describe, expect, it } from 'bun:test'
import { AUTH_REFUSALS } from '@raven/core'
import {
  contentRangeStart,
  DOWNLOAD_STALL_MS,
  FETCH_REASONS,
  fetchToFile,
  PROGRESS_STEP_BYTES,
  PROGRESS_STEP_MS,
  type FetchOutcome,
  type PartFile,
  type StreamFetch,
} from '@/main/downloads/fetchFile'
import { brokenBody } from '@/main/test/downloadFakes'
import { fakeTimers } from '@/main/test/playerFakes'
import { HTTP_HEADERS } from '@/shared/httpHeaders'

type Reply = {
  status: number
  headers?: Record<string, string>
  body: ReadableStream<Uint8Array> | null
}

const bytesOf = (length: number, fill = 1): Uint8Array => new Uint8Array(length).fill(fill)

const textOf = (text: string): Uint8Array => new TextEncoder().encode(text)

/** A body that delivers `chunks` and ends. */
const bodyOf = (chunks: Uint8Array[]): ReadableStream<Uint8Array> =>
  new ReadableStream<Uint8Array>({
    start(controller) {
      chunks.forEach((chunk) => controller.enqueue(chunk))
      controller.close()
    },
  })

/** A body that delivers `chunks` and then waits forever, the way a stalled connection does. */
const heldBody = (chunks: Uint8Array[]): ReadableStream<Uint8Array> =>
  new ReadableStream<Uint8Array>({
    start(controller) {
      chunks.forEach((chunk) => controller.enqueue(chunk))
    },
  })

const reply = (input: Reply): Reply => input

/** A fetch that answers `replies` in order, or rejects with `error`, and records every call. */
const fakeFetch = ({ replies, error }: { replies: Reply[]; error?: unknown }) => {
  const calls: { url: string; headers: Record<string, string> }[] = []
  const fetch: StreamFetch = async ({ url, headers }) => {
    calls.push({ url, headers })
    if (error !== undefined) throw error
    const next = replies[calls.length - 1]
    if (next === undefined) throw new Error('no reply left')
    const headerMap = new Map(Object.entries(next.headers ?? {}))
    return {
      status: next.status,
      headers: { get: (name) => headerMap.get(name) ?? null },
      body: next.body,
    }
  }
  return { fetch, calls }
}

/** A part file over an array of chunks. */
const fakePart = ({
  disk = [],
  failAppend,
}: {
  disk?: Uint8Array[]
  failAppend?: unknown
} = {}) => {
  const chunks = [...disk]
  const flags = { closes: 0, truncates: 0 }
  const part: PartFile = {
    size: async () => chunks.reduce((sum, chunk) => sum + chunk.length, 0),
    append: async (chunk) => {
      if (failAppend !== undefined) throw failAppend
      chunks.push(chunk)
    },
    truncate: async () => {
      chunks.splice(0, chunks.length)
      flags.truncates += 1
    },
    close: async () => {
      flags.closes += 1
    },
  }
  return { part, chunks, flags }
}

const sizeOf = (chunks: Uint8Array[]): number =>
  chunks.reduce((sum, chunk) => sum + chunk.length, 0)

const URL_OF_FILE = 'http://192.168.1.5:3000/media/42/file?ticket=abc'

const run = ({
  fetch,
  part,
  expectedSize,
  signal = new AbortController().signal,
  timers = fakeTimers().timers,
  now = () => 0,
  stallMs,
  onProgress = () => undefined,
}: {
  fetch: StreamFetch
  part: PartFile
  expectedSize: number
  signal?: AbortSignal
  timers?: ReturnType<typeof fakeTimers>['timers']
  now?: () => number
  stallMs?: number
  onProgress?: (bytes: number) => void
}): Promise<FetchOutcome> =>
  fetchToFile({
    fetch,
    url: URL_OF_FILE,
    part,
    expectedSize,
    signal,
    timers,
    now,
    onProgress,
    ...(stallMs === undefined ? {} : { stallMs }),
  })

const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

describe('constants', () => {
  it('are the spec values', () => {
    expect(PROGRESS_STEP_BYTES).toBe(8 * 1024 ** 2)
    expect(PROGRESS_STEP_MS).toBe(1000)
    expect(DOWNLOAD_STALL_MS).toBe(30_000)
  })
})

describe('contentRangeStart', () => {
  it('reads the first byte of a range', () => {
    expect(contentRangeStart('bytes 1024-2047/4096')).toBe(1024)
    expect(contentRangeStart('bytes 0-9/10')).toBe(0)
  })

  it('answers null for a missing or malformed header', () => {
    expect(contentRangeStart(null)).toBeNull()
    expect(contentRangeStart('')).toBeNull()
    expect(contentRangeStart('bytes */4096')).toBeNull()
    expect(contentRangeStart('items 1-2/3')).toBeNull()
    expect(contentRangeStart('bytes -5-10/20')).toBeNull()
  })
})

describe('a whole file', () => {
  it('is appended from a 200 with no Range header', async () => {
    const { fetch, calls } = fakeFetch({
      replies: [reply({ status: 200, body: bodyOf([bytesOf(10), bytesOf(5, 2)]) })],
    })
    const { part, chunks, flags } = fakePart()
    const outcome = await run({ fetch, part, expectedSize: 15 })
    expect(outcome).toEqual({ ok: true, bytes: 15 })
    expect(sizeOf(chunks)).toBe(15)
    expect(calls).toEqual([{ url: URL_OF_FILE, headers: {} }])
    expect(flags.closes).toBe(1)
  })

  it('reports progress at each step of bytes and time, and once at the end', async () => {
    const { fetch } = fakeFetch({
      replies: [
        reply({
          status: 200,
          body: bodyOf([
            bytesOf(PROGRESS_STEP_BYTES),
            bytesOf(PROGRESS_STEP_BYTES),
            bytesOf(PROGRESS_STEP_BYTES / 2),
          ]),
        }),
      ],
    })
    const { part } = fakePart()
    const reported: number[] = []
    const clock = { calls: 0 }
    const outcome = await run({
      fetch,
      part,
      expectedSize: PROGRESS_STEP_BYTES * 2.5,
      now: () => {
        clock.calls += 1
        return clock.calls * PROGRESS_STEP_MS
      },
      onProgress: (bytes) => reported.push(bytes),
    })
    expect(outcome).toEqual({ ok: true, bytes: PROGRESS_STEP_BYTES * 2.5 })
    expect(reported).toEqual([
      PROGRESS_STEP_BYTES,
      PROGRESS_STEP_BYTES * 2,
      PROGRESS_STEP_BYTES * 2.5,
    ])
  })

  it('waits for the time step even when the bytes are in', async () => {
    const { fetch } = fakeFetch({
      replies: [
        reply({
          status: 200,
          body: bodyOf([bytesOf(PROGRESS_STEP_BYTES), bytesOf(PROGRESS_STEP_BYTES)]),
        }),
      ],
    })
    const { part } = fakePart()
    const reported: number[] = []
    await run({
      fetch,
      part,
      expectedSize: PROGRESS_STEP_BYTES * 2,
      now: () => 0,
      onProgress: (bytes) => reported.push(bytes),
    })
    expect(reported).toEqual([PROGRESS_STEP_BYTES * 2])
  })

  it('waits for the byte step even when the time is in', async () => {
    const { fetch } = fakeFetch({
      replies: [reply({ status: 200, body: bodyOf([bytesOf(10), bytesOf(10), bytesOf(10)]) })],
    })
    const { part } = fakePart()
    const reported: number[] = []
    const clock = { calls: 0 }
    await run({
      fetch,
      part,
      expectedSize: 30,
      now: () => {
        clock.calls += 1
        return clock.calls * PROGRESS_STEP_MS * 10
      },
      onProgress: (bytes) => reported.push(bytes),
    })
    expect(reported).toEqual([30])
  })

  it('treats a missing body as an empty one', async () => {
    const { fetch } = fakeFetch({ replies: [reply({ status: 200, body: null })] })
    const { part, flags } = fakePart()
    const outcome = await run({ fetch, part, expectedSize: 4 })
    expect(outcome).toEqual({ ok: false, reason: 'changed', status: null, refusal: null, bytes: 0 })
    expect(flags.closes).toBe(1)
  })
})

describe('a resume', () => {
  it('asks for the bytes after the ones on disk and appends them', async () => {
    const { fetch, calls } = fakeFetch({
      replies: [
        reply({
          status: 206,
          headers: { 'content-range': 'bytes 4096-8191/8192' },
          body: bodyOf([bytesOf(4096, 2)]),
        }),
      ],
    })
    const { part, chunks, flags } = fakePart({ disk: [bytesOf(4096)] })
    const outcome = await run({ fetch, part, expectedSize: 8192 })
    expect(outcome).toEqual({ ok: true, bytes: 8192 })
    expect(calls).toEqual([{ url: URL_OF_FILE, headers: { Range: 'bytes=4096-' } }])
    expect(sizeOf(chunks)).toBe(8192)
    expect(flags.truncates).toBe(0)
  })

  it('starts over without a Range header when the server answers 200', async () => {
    const { fetch, calls } = fakeFetch({
      replies: [
        reply({ status: 200, body: bodyOf([bytesOf(8192, 3)]) }),
        reply({ status: 200, body: bodyOf([bytesOf(8192, 3)]) }),
      ],
    })
    const { part, chunks, flags } = fakePart({ disk: [bytesOf(4096)] })
    const outcome = await run({ fetch, part, expectedSize: 8192 })
    expect(outcome).toEqual({ ok: true, bytes: 8192 })
    expect(calls.map((call) => call.headers)).toEqual([{ Range: 'bytes=4096-' }, {}])
    expect(flags.truncates).toBe(1)
    expect(sizeOf(chunks)).toBe(8192)
  })

  it('starts over when the content-range begins at another byte', async () => {
    const { fetch, calls } = fakeFetch({
      replies: [
        reply({
          status: 206,
          headers: { 'content-range': 'bytes 0-8191/8192' },
          body: bodyOf([bytesOf(8192)]),
        }),
        reply({ status: 200, body: bodyOf([bytesOf(8192)]) }),
      ],
    })
    const { part, chunks, flags } = fakePart({ disk: [bytesOf(4096)] })
    const outcome = await run({ fetch, part, expectedSize: 8192 })
    expect(outcome).toEqual({ ok: true, bytes: 8192 })
    expect(calls.map((call) => call.headers)).toEqual([{ Range: 'bytes=4096-' }, {}])
    expect(flags.truncates).toBe(1)
    expect(sizeOf(chunks)).toBe(8192)
  })

  it('starts over when the content-range is missing', async () => {
    const { fetch } = fakeFetch({
      replies: [
        reply({ status: 206, body: bodyOf([bytesOf(4096)]) }),
        reply({ status: 200, body: bodyOf([bytesOf(8192)]) }),
      ],
    })
    const { part, flags } = fakePart({ disk: [bytesOf(4096)] })
    const outcome = await run({ fetch, part, expectedSize: 8192 })
    expect(outcome).toEqual({ ok: true, bytes: 8192 })
    expect(flags.truncates).toBe(1)
  })

  it('is changed on a second mismatch, after one restart at most', async () => {
    const { fetch, calls } = fakeFetch({
      replies: [
        reply({ status: 200, body: bodyOf([bytesOf(8192)]) }),
        reply({
          status: 206,
          headers: { 'content-range': 'bytes 0-8191/8192' },
          body: bodyOf([bytesOf(8192)]),
        }),
      ],
    })
    const { part, flags } = fakePart({ disk: [bytesOf(4096)] })
    const outcome = await run({ fetch, part, expectedSize: 8192 })
    expect(outcome).toEqual({ ok: false, reason: 'changed', status: null, refusal: null, bytes: 0 })
    expect(calls).toHaveLength(2)
    expect(flags.closes).toBe(1)
  })

  it('is changed when a fresh download is answered with a 206', async () => {
    const { fetch } = fakeFetch({
      replies: [
        reply({
          status: 206,
          headers: { 'content-range': 'bytes 0-9/10' },
          body: bodyOf([bytesOf(10)]),
        }),
      ],
    })
    const { part, chunks, flags } = fakePart()
    const outcome = await run({ fetch, part, expectedSize: 10 })
    expect(outcome).toEqual({ ok: false, reason: 'changed', status: null, refusal: null, bytes: 0 })
    expect(sizeOf(chunks)).toBe(0)
    expect(flags.closes).toBe(1)
  })
})

describe('a part that is already whole', () => {
  it('is ok with no request and one progress call when it equals the expected size', async () => {
    const { fetch, calls } = fakeFetch({ replies: [] })
    const { part, flags } = fakePart({ disk: [bytesOf(6), bytesOf(4)] })
    const reported: number[] = []
    const outcome = await run({
      fetch,
      part,
      expectedSize: 10,
      onProgress: (bytes) => reported.push(bytes),
    })
    expect(outcome).toEqual({ ok: true, bytes: 10 })
    expect(calls).toHaveLength(0)
    expect(reported).toEqual([10])
    expect(flags.truncates).toBe(0)
    expect(flags.closes).toBe(1)
  })

  it('is truncated and fetched from 0 with no Range when it is larger than expected', async () => {
    const { fetch, calls } = fakeFetch({
      replies: [reply({ status: 200, body: bodyOf([bytesOf(10)]) })],
    })
    const { part, chunks, flags } = fakePart({ disk: [bytesOf(15)] })
    const outcome = await run({ fetch, part, expectedSize: 10 })
    expect(outcome).toEqual({ ok: true, bytes: 10 })
    expect(calls).toEqual([{ url: URL_OF_FILE, headers: {} }])
    expect(flags.truncates).toBe(1)
    expect(sizeOf(chunks)).toBe(10)
    expect(flags.closes).toBe(1)
  })

  it('is changed, with no request, when the part is still too large after one restart', async () => {
    const { fetch, calls } = fakeFetch({ replies: [] })
    const { part, flags } = fakePart()
    const outcome = await run({ fetch, part, expectedSize: -1 })
    expect(outcome).toEqual({ ok: false, reason: 'changed', status: null, refusal: null, bytes: 0 })
    expect(calls).toHaveLength(0)
    expect(flags.truncates).toBe(2)
    expect(flags.closes).toBe(1)
  })
})

describe('the size', () => {
  it('is changed and truncated when the body is short', async () => {
    const { fetch } = fakeFetch({ replies: [reply({ status: 200, body: bodyOf([bytesOf(7)]) })] })
    const { part, chunks, flags } = fakePart()
    const outcome = await run({ fetch, part, expectedSize: 10 })
    expect(outcome).toEqual({ ok: false, reason: 'changed', status: null, refusal: null, bytes: 0 })
    expect(sizeOf(chunks)).toBe(0)
    expect(flags.truncates).toBe(1)
    expect(flags.closes).toBe(1)
  })

  it('is changed and truncated as soon as the body runs past it', async () => {
    const { fetch } = fakeFetch({
      replies: [reply({ status: 200, body: bodyOf([bytesOf(6), bytesOf(6), bytesOf(6)]) })],
    })
    const { part, chunks, flags } = fakePart()
    const outcome = await run({ fetch, part, expectedSize: 10 })
    expect(outcome).toEqual({ ok: false, reason: 'changed', status: null, refusal: null, bytes: 0 })
    expect(sizeOf(chunks)).toBe(0)
    expect(flags.truncates).toBe(1)
    expect(flags.closes).toBe(1)
  })
})

describe('a stall', () => {
  it('cuts the read off and keeps the part', async () => {
    const { fetch } = fakeFetch({
      replies: [reply({ status: 200, body: heldBody([bytesOf(5)]) })],
    })
    const { part, chunks, flags } = fakePart()
    const clock = fakeTimers()
    const pending = run({ fetch, part, expectedSize: 10, timers: clock.timers })
    await settle()
    expect([...clock.pending.values()].map((timer) => timer.ms)).toEqual([DOWNLOAD_STALL_MS])
    clock.fire()
    expect(await pending).toEqual({
      ok: false,
      reason: 'stalled',
      status: null,
      refusal: null,
      bytes: 5,
    })
    expect(sizeOf(chunks)).toBe(5)
    expect(flags.closes).toBe(1)
    expect(clock.pending.size).toBe(0)
  })

  it('uses the stall time it is given', async () => {
    const { fetch } = fakeFetch({ replies: [reply({ status: 200, body: heldBody([]) })] })
    const { part } = fakePart()
    const clock = fakeTimers()
    const pending = run({ fetch, part, expectedSize: 10, timers: clock.timers, stallMs: 1234 })
    await settle()
    expect([...clock.pending.values()].map((timer) => timer.ms)).toEqual([1234])
    clock.fire()
    expect(await pending).toEqual({
      ok: false,
      reason: 'stalled',
      status: null,
      refusal: null,
      bytes: 0,
    })
  })

  it('clears its timer when the file completes', async () => {
    const { fetch } = fakeFetch({ replies: [reply({ status: 200, body: bodyOf([bytesOf(3)]) })] })
    const { part } = fakePart()
    const clock = fakeTimers()
    await run({ fetch, part, expectedSize: 3, timers: clock.timers })
    expect(clock.pending.size).toBe(0)
  })
})

describe('a full disk', () => {
  it('is space, and the part is kept', async () => {
    const full = Object.assign(new Error('no space left on device'), { code: 'ENOSPC' })
    const { fetch } = fakeFetch({
      replies: [
        reply({
          status: 206,
          headers: { 'content-range': 'bytes 2-11/12' },
          body: bodyOf([bytesOf(5), bytesOf(5)]),
        }),
      ],
    })
    const { part, flags } = fakePart({ disk: [bytesOf(2)], failAppend: full })
    const outcome = await run({ fetch, part, expectedSize: 12 })
    expect(outcome).toEqual({ ok: false, reason: 'space', status: null, refusal: null, bytes: 2 })
    expect(flags.truncates).toBe(0)
    expect(flags.closes).toBe(1)
  })

  it('lets any other write error through, after closing the file', async () => {
    const broken = Object.assign(new Error('input/output error'), { code: 'EIO' })
    const { fetch } = fakeFetch({ replies: [reply({ status: 200, body: bodyOf([bytesOf(5)]) })] })
    const { part, flags } = fakePart({ failAppend: broken })
    await expect(run({ fetch, part, expectedSize: 5 })).rejects.toBe(broken)
    expect(flags.closes).toBe(1)
  })
})

describe('a refusal', () => {
  const refused = async ({ status, disk = [] }: { status: number; disk?: Uint8Array[] }) => {
    const { fetch } = fakeFetch({ replies: [reply({ status, body: bodyOf([bytesOf(3)]) })] })
    const { part, flags, chunks } = fakePart({ disk })
    const outcome = await run({ fetch, part, expectedSize: 10 })
    return { outcome, flags, chunks }
  }

  it('maps 401 to unauthorized', async () => {
    const { outcome, flags } = await refused({ status: 401 })
    expect(outcome).toEqual({
      ok: false,
      reason: 'unauthorized',
      status: 401,
      refusal: null,
      bytes: 0,
    })
    expect(flags.closes).toBe(1)
  })

  it('maps 423 to locked', async () => {
    const { outcome, flags } = await refused({ status: 423 })
    expect(outcome).toEqual({ ok: false, reason: 'locked', status: 423, refusal: null, bytes: 0 })
    expect(flags.closes).toBe(1)
  })

  it('maps 416 to changed, and truncates the part it can no longer use', async () => {
    const { outcome, flags, chunks } = await refused({ status: 416, disk: [bytesOf(4)] })
    expect(outcome).toEqual({ ok: false, reason: 'changed', status: 416, refusal: null, bytes: 0 })
    expect(flags.truncates).toBe(1)
    expect(sizeOf(chunks)).toBe(0)
    expect(flags.closes).toBe(1)
  })

  it('maps any other non-2xx to status with its code', async () => {
    const { outcome, flags } = await refused({ status: 500 })
    expect(outcome).toEqual({ ok: false, reason: 'status', status: 500, refusal: null, bytes: 0 })
    expect(flags.closes).toBe(1)
    expect((await refused({ status: 404 })).outcome).toEqual({
      ok: false,
      reason: 'status',
      status: 404,
      refusal: null,
      bytes: 0,
    })
  })

  it.each([
    [403, AUTH_REFUSALS.pending],
    [403, AUTH_REFUSALS.revoked],
    [401, AUTH_REFUSALS.signedOut],
  ] as const)('carries the account refusal a %p body names: %s', async (status, reason) => {
    const { fetch } = fakeFetch({
      replies: [
        reply({ status, body: bodyOf([textOf(JSON.stringify({ reason, message: 'No.' }))]) }),
      ],
    })
    const outcome = await run({ fetch, part: fakePart({}).part, expectedSize: 10 })
    expect(outcome).toEqual({
      ok: false,
      reason: status === 401 ? FETCH_REASONS.unauthorized : FETCH_REASONS.status,
      status,
      refusal: reason,
      bytes: 0,
    })
  })

  it('carries no refusal for a body that names accounts being down', async () => {
    const body = JSON.stringify({ reason: AUTH_REFUSALS.unavailable, message: 'Down.' })
    const { fetch } = fakeFetch({ replies: [reply({ status: 403, body: bodyOf([textOf(body)]) })] })
    const outcome = await run({ fetch, part: fakePart({}).part, expectedSize: 10 })
    expect(outcome).toEqual({ ok: false, reason: 'status', status: 403, refusal: null, bytes: 0 })
  })

  it('keeps the bytes on disk', async () => {
    const { outcome, chunks } = await refused({ status: 401, disk: [bytesOf(6)] })
    expect(outcome).toEqual({
      ok: false,
      reason: 'unauthorized',
      status: 401,
      refusal: null,
      bytes: 6,
    })
    expect(sizeOf(chunks)).toBe(6)
  })
})

describe('the network', () => {
  it('is unreachable when fetch rejects', async () => {
    const { fetch } = fakeFetch({ replies: [], error: new TypeError('fetch failed') })
    const { part, flags } = fakePart({ disk: [bytesOf(3)] })
    const outcome = await run({ fetch, part, expectedSize: 10 })
    expect(outcome).toEqual({
      ok: false,
      reason: 'unreachable',
      status: null,
      refusal: null,
      bytes: 3,
    })
    expect(flags.closes).toBe(1)
  })
})

describe('a cut', () => {
  it('is a cut, with the bytes so far kept, when the body breaks mid-way', async () => {
    const { fetch } = fakeFetch({
      replies: [reply({ status: 200, body: brokenBody([bytesOf(4)]) })],
    })
    const { part, chunks, flags } = fakePart()
    const outcome = await run({ fetch, part, expectedSize: 10 })
    expect(outcome).toEqual({
      ok: false,
      reason: FETCH_REASONS.cut,
      status: null,
      refusal: null,
      bytes: 4,
    })
    expect(sizeOf(chunks)).toBe(4)
    expect(flags.truncates).toBe(0)
    expect(flags.closes).toBe(1)
  })

  it('is a cut, never a whole file, when the body ends short of its content-length', async () => {
    const { fetch } = fakeFetch({
      replies: [
        reply({
          status: 200,
          headers: { [HTTP_HEADERS.contentLength]: '10' },
          body: bodyOf([bytesOf(6)]),
        }),
      ],
    })
    const { part, chunks, flags } = fakePart()
    const reported: number[] = []
    const outcome = await run({
      fetch,
      part,
      expectedSize: 10,
      onProgress: (bytes) => reported.push(bytes),
    })
    expect(outcome).toEqual({
      ok: false,
      reason: FETCH_REASONS.cut,
      status: null,
      refusal: null,
      bytes: 6,
    })
    expect(sizeOf(chunks)).toBe(6)
    expect(flags.truncates).toBe(0)
    expect(reported).toEqual([])
  })

  it('is a cut when a resumed body ends short of its content-range', async () => {
    const { fetch } = fakeFetch({
      replies: [
        reply({
          status: 206,
          headers: { [HTTP_HEADERS.contentRange]: 'bytes 4-9/10' },
          body: bodyOf([bytesOf(2)]),
        }),
      ],
    })
    const { part, chunks, flags } = fakePart({ disk: [bytesOf(4)] })
    const outcome = await run({ fetch, part, expectedSize: 10 })
    expect(outcome).toEqual({
      ok: false,
      reason: FETCH_REASONS.cut,
      status: null,
      refusal: null,
      bytes: 6,
    })
    expect(sizeOf(chunks)).toBe(6)
    expect(flags.truncates).toBe(0)
  })

  it('is changed, never whole, when the body sends all it promised and that falls short of the file', async () => {
    const { fetch } = fakeFetch({
      replies: [
        reply({
          status: 200,
          headers: { [HTTP_HEADERS.contentLength]: '6' },
          body: bodyOf([bytesOf(6)]),
        }),
      ],
    })
    const { part, chunks, flags } = fakePart()
    const outcome = await run({ fetch, part, expectedSize: 10 })
    expect(outcome).toEqual({
      ok: false,
      reason: FETCH_REASONS.changed,
      status: null,
      refusal: null,
      bytes: 0,
    })
    expect(sizeOf(chunks)).toBe(0)
    expect(flags.truncates).toBe(1)
  })

  it('is whole only once the part holds the whole file', async () => {
    const { fetch } = fakeFetch({
      replies: [
        reply({
          status: 206,
          headers: {
            [HTTP_HEADERS.contentRange]: 'bytes 4-9/10',
            [HTTP_HEADERS.contentLength]: '6',
          },
          body: bodyOf([bytesOf(6)]),
        }),
      ],
    })
    const { part, chunks } = fakePart({ disk: [bytesOf(4)] })
    expect(await run({ fetch, part, expectedSize: 10 })).toEqual({ ok: true, bytes: 10 })
    expect(sizeOf(chunks)).toBe(10)
  })
})

describe('an abort', () => {
  it('is aborted when fetch rejects with an AbortError on an aborted signal', async () => {
    const controller = new AbortController()
    controller.abort()
    const { fetch } = fakeFetch({
      replies: [],
      error: new DOMException('This operation was aborted', 'AbortError'),
    })
    const { part, flags } = fakePart({ disk: [bytesOf(3)] })
    const outcome = await run({ fetch, part, expectedSize: 10, signal: controller.signal })
    expect(outcome).toEqual({ ok: false, reason: 'aborted', status: null, refusal: null, bytes: 3 })
    expect(flags.closes).toBe(1)
  })

  it('is unreachable when an AbortError comes while the signal is not aborted', async () => {
    const { fetch } = fakeFetch({
      replies: [],
      error: new DOMException('timed out', 'AbortError'),
    })
    const { part } = fakePart()
    const outcome = await run({ fetch, part, expectedSize: 10 })
    expect(outcome).toEqual({
      ok: false,
      reason: 'unreachable',
      status: null,
      refusal: null,
      bytes: 0,
    })
  })

  it('is aborted mid-body with the bytes so far kept', async () => {
    const controller = new AbortController()
    const { fetch } = fakeFetch({
      replies: [reply({ status: 200, body: heldBody([bytesOf(5)]) })],
    })
    const { part, chunks, flags } = fakePart()
    const clock = fakeTimers()
    const pending = run({
      fetch,
      part,
      expectedSize: 10,
      signal: controller.signal,
      timers: clock.timers,
    })
    await settle()
    controller.abort()
    expect(await pending).toEqual({
      ok: false,
      reason: 'aborted',
      status: null,
      refusal: null,
      bytes: 5,
    })
    expect(sizeOf(chunks)).toBe(5)
    expect(flags.truncates).toBe(0)
    expect(flags.closes).toBe(1)
    expect(clock.pending.size).toBe(0)
  })
})

describe('a server that never answers', () => {
  it('stalls once the headers are late, and aborts the request', async () => {
    const { timers, fire, pending } = fakeTimers()
    const seen: { signal: AbortSignal | null } = { signal: null }
    const fetch: StreamFetch = ({ signal }) => {
      seen.signal = signal
      return new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
      })
    }
    const { part } = fakePart()
    const outcome = run({ fetch, part, expectedSize: 10, timers })
    await settle()
    expect([...pending.values()].map(({ ms }) => ms)).toEqual([DOWNLOAD_STALL_MS])
    fire()
    expect(await outcome).toEqual({
      ok: false,
      reason: 'stalled',
      status: null,
      refusal: null,
      bytes: 0,
    })
    expect(seen.signal?.aborted).toBe(true)
  })

  it('clears that wait once the headers come', async () => {
    const { timers, pending } = fakeTimers()
    const { fetch } = fakeFetch({ replies: [reply({ status: 200, body: bodyOf([bytesOf(10)]) })] })
    const { part } = fakePart()
    expect(await run({ fetch, part, expectedSize: 10, timers })).toEqual({ ok: true, bytes: 10 })
    expect(pending.size).toBe(0)
  })
})
