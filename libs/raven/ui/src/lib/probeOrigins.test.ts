import { describe, expect, it, mock } from 'bun:test'
import type { MediaOrigin } from '@raven/core'
import { type ProbeFetch, probeOrigin, probeOrigins } from '@/lib/probeOrigins'
import { api } from '@/test/api'

const lan: MediaOrigin = { kind: 'lan', url: 'https://lan.example' }
const pub: MediaOrigin = { kind: 'public', url: 'https://public.example' }
const BYTES = 262_144

const clock = () => {
  const state = { time: 1000 }
  return { now: () => state.time, advance: (ms: number) => void (state.time += ms) }
}

type Chunk = { after: number; size: number }

/** A body whose chunks arrive after the given delays on the test's clock. */
const bodyOf = ({
  chunks,
  advance,
}: {
  chunks: readonly Chunk[]
  advance: (ms: number) => void
}): ReadableStream<Uint8Array> => {
  const queue = [...chunks]
  return new ReadableStream<Uint8Array>(
    {
      pull: (controller) => {
        const next = queue.shift()
        if (!next) return controller.close()
        advance(next.after)
        controller.enqueue(new Uint8Array(next.size))
      },
    },
    { highWaterMark: 0 },
  )
}

describe('probeOrigin', () => {
  it('measures time to first byte and throughput of the body', async () => {
    const { now, advance } = clock()
    const fetch: ProbeFetch = mock(async () => {
      advance(10)
      return {
        ok: true,
        body: bodyOf({
          advance,
          chunks: [
            { after: 40, size: 1 },
            { after: 200, size: BYTES - 1 },
          ],
        }),
      }
    })
    const probe = await probeOrigin({ origin: lan, api, fetch, now })
    expect(probe).toEqual({ origin: lan, firstByteMs: 50, bytesPerSecond: 1_310_720 })
    expect(fetch).toHaveBeenCalledWith(
      api.pingUrl({ origin: lan }),
      expect.objectContaining({ cache: 'no-store' }),
    )
  })

  it('does not divide by zero when the whole body lands in one read', async () => {
    const { now, advance } = clock()
    const fetch: ProbeFetch = async () => ({
      ok: true,
      body: bodyOf({ advance, chunks: [{ after: 5, size: BYTES }] }),
    })
    const probe = await probeOrigin({ origin: lan, api, fetch, now })
    expect(probe?.firstByteMs).toBe(5)
    expect(probe?.bytesPerSecond).toBe(BYTES / 0.001)
  })

  it('gives null on a non-ok answer, a missing body, a thrown fetch and a short body', async () => {
    const { now, advance } = clock()
    const probeWith = (fetch: ProbeFetch) => probeOrigin({ origin: lan, api, fetch, now })
    expect(await probeWith(async () => ({ ok: false, body: null }))).toBeNull()
    expect(await probeWith(async () => ({ ok: true, body: null }))).toBeNull()
    expect(
      await probeWith(async () => {
        throw new Error('network down')
      }),
    ).toBeNull()
    expect(
      await probeWith(async () => ({
        ok: true,
        body: bodyOf({ advance, chunks: [{ after: 1, size: BYTES - 1 }] }),
      })),
    ).toBeNull()
    expect(
      await probeWith(async () => ({ ok: true, body: bodyOf({ advance, chunks: [] }) })),
    ).toBeNull()
  })

  it('gives null on timeout, aborting a fetch that never answers', async () => {
    const { now } = clock()
    const signals: AbortSignal[] = []
    const fetch: ProbeFetch = (_url, { signal }) => {
      signals.push(signal)
      return new Promise(() => {})
    }
    expect(await probeOrigin({ origin: lan, api, fetch, now, timeoutMs: 20 })).toBeNull()
    expect(signals[0]?.aborted).toBe(true)
  })

  it('cancels the body of a fetch that ignores its signal once time is up', async () => {
    const { now } = clock()
    const cancel = mock(() => {})
    const fetch: ProbeFetch = async () => ({
      ok: true,
      body: new ReadableStream<Uint8Array>({ pull: () => new Promise(() => {}), cancel }),
    })
    expect(await probeOrigin({ origin: lan, api, fetch, now, timeoutMs: 20 })).toBeNull()
    await new Promise((resolve) => setTimeout(resolve, 5))
    expect(cancel).toHaveBeenCalledTimes(1)
  })

  it('gives null on timeout when the body stalls after the headers', async () => {
    const { now } = clock()
    const fetch: ProbeFetch = async () => ({
      ok: true,
      body: new ReadableStream<Uint8Array>({ pull: () => new Promise(() => {}) }),
    })
    expect(await probeOrigin({ origin: lan, api, fetch, now, timeoutMs: 20 })).toBeNull()
  })
})

describe('probeOrigins', () => {
  it('probes every origin in parallel, and leaves out those that gave nothing', async () => {
    const { now, advance } = clock()
    const started: string[] = []
    const releases: (() => void)[] = []
    const fetch: ProbeFetch = (url) => {
      started.push(url)
      if (url.startsWith(pub.url)) return Promise.reject(new Error('unreachable'))
      return new Promise((resolve) => {
        releases.push(() =>
          resolve({ ok: true, body: bodyOf({ advance, chunks: [{ after: 1, size: BYTES }] }) }),
        )
      })
    }
    const running = probeOrigins({ origins: [lan, pub], api, fetch, now })
    await Promise.resolve()
    expect(started).toEqual([api.pingUrl({ origin: lan }), api.pingUrl({ origin: pub })])
    releases.forEach((release) => release())
    const probes = await running
    expect(probes.map(({ origin }) => origin)).toEqual([lan])
  })
})
