import { describe, expect, it } from 'bun:test'
import { OVERFLOWS, readCapped } from '@/main/servers/cappedBody'

type ChunkedProps = { chunks: readonly string[]; cancelled?: { count: number } }

/** A body sent as these chunks, counting the times it is let go of. */
const chunked = ({
  chunks,
  cancelled = { count: 0 },
}: ChunkedProps): ReadableStream<Uint8Array> => {
  const encoder = new TextEncoder()
  const queued = [...chunks]
  return new ReadableStream<Uint8Array>({
    pull: (controller) => {
      const next = queued.shift()
      if (next === undefined) {
        controller.close()
        return
      }
      controller.enqueue(encoder.encode(next))
    },
    cancel: () => {
      cancelled.count += 1
    },
  })
}

describe('readCapped', () => {
  it('reads a body under its cap whole, and no body as empty text', async () => {
    const body = chunked({ chunks: ['ab', 'cd'] })
    expect(await readCapped({ body, maxChars: 4, onOverflow: OVERFLOWS.refuse })).toBe('abcd')
    expect(await readCapped({ body: null, maxChars: 4, onOverflow: OVERFLOWS.refuse })).toBe('')
  })

  it('truncates one chunk past the cap and lets go of the rest', async () => {
    const cancelled = { count: 0 }
    const body = chunked({ chunks: ['abc', 'def', 'ghi'], cancelled })
    expect(await readCapped({ body, maxChars: 4, onOverflow: OVERFLOWS.truncate })).toBe('abcdef')
    expect(cancelled.count).toBe(1)
  })

  it('refuses a body past the cap', async () => {
    const body = chunked({ chunks: ['abc', 'def'] })
    expect(await readCapped({ body, maxChars: 4, onOverflow: OVERFLOWS.refuse })).toBeNull()
  })

  it('rejects a read that fails', async () => {
    const body = new ReadableStream<Uint8Array>({
      pull: (controller) => controller.error(new Error('cut')),
    })
    const outcome = await readCapped({ body, maxChars: 4, onOverflow: OVERFLOWS.truncate }).then(
      () => 'read',
      () => 'failed',
    )
    expect(outcome).toBe('failed')
  })
})
