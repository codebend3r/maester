import { describe, expect, it } from 'bun:test'
import { type RawEvent, readEvents } from '@/lib/sse'

const streamOf = (parts: string[]) => {
  const encoder = new TextEncoder()
  return new ReadableStream<Uint8Array>({
    start: (controller) => {
      parts.forEach((part) => controller.enqueue(encoder.encode(part)))
      controller.close()
    },
  })
}

describe('readEvents', () => {
  it('hands over each event, even one split across reads', async () => {
    const seen: RawEvent[] = []
    await readEvents({
      body: streamOf(['event: text\ndata: {"text":', '"hi"}\n\nevent: done\n', 'data: {}\n\n']),
      onEvent: (event) => seen.push(event),
    })
    expect(seen).toEqual([
      { name: 'text', data: '{"text":"hi"}' },
      { name: 'done', data: '{}' },
    ])
  })

  it('joins multi-line data and keeps a last block with no blank line after it', async () => {
    const seen: RawEvent[] = []
    await readEvents({
      body: streamOf(['event: text\ndata: one\ndata: two']),
      onEvent: (event) => seen.push(event),
    })
    expect(seen).toEqual([{ name: 'text', data: 'one\ntwo' }])
  })
})
