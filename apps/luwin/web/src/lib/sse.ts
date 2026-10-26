/**
 * Server-sent events read from a fetch body. The chat routes are POSTs, which
 * `EventSource` can't send, so the stream is parsed here: blocks split on a
 * blank line, each with an `event:` name and `data:` lines.
 */

export type RawEvent = { name: string; data: string }

const FIELDS = { event: 'event: ', data: 'data: ' } as const

const parseBlock = (block: string): RawEvent => {
  const lines = block.split('\n')
  const name = lines.find((line) => line.startsWith(FIELDS.event))?.slice(FIELDS.event.length)
  const data = lines
    .filter((line) => line.startsWith(FIELDS.data))
    .map((line) => line.slice(FIELDS.data.length))
    .join('\n')
  return { name: name ?? '', data }
}

type PumpProps = {
  reader: ReadableStreamDefaultReader<Uint8Array>
  decoder: TextDecoder
  buffer: string
  onEvent: (event: RawEvent) => void
}

const pump = async ({ reader, decoder, buffer, onEvent }: PumpProps): Promise<void> => {
  const { done, value } = await reader.read()
  const text = buffer + decoder.decode(value, { stream: !done })
  const blocks = text.split('\n\n')
  // The last block may still be arriving; it waits for the next read.
  const rest = done ? '' : (blocks.pop() ?? '')
  blocks.filter((block) => block.trim() !== '').forEach((block) => onEvent(parseBlock(block)))
  if (done) return
  await pump({ reader, decoder, buffer: rest, onEvent })
}

type ReadEventsProps = {
  body: ReadableStream<Uint8Array>
  onEvent: (event: RawEvent) => void
}

/** Hands each event in `body` to `onEvent` as it arrives; resolves when the stream ends. */
export const readEvents = async ({ body, onEvent }: ReadEventsProps): Promise<void> =>
  pump({ reader: body.getReader(), decoder: new TextDecoder(), buffer: '', onEvent })
