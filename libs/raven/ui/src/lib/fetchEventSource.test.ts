import { describe, expect, it } from 'bun:test'
import { waitFor } from '@testing-library/react'
import { AUTH_HEADERS, AUTH_SCHEME } from '@raven/core'
import { HTTP_STATUSES } from '@shared/http'
import { fetchEventSource } from '@/lib/fetchEventSource'
import { SERVER_STREAM_EVENTS, SERVER_STREAM_STATES } from '@/query/useServerEvents'

type Asked = { url: string; init: RequestInit | undefined }

type StreamingServerProps = { status?: number }

/** The stream's controller once the body starts, so a test can push to it and end it. */
type StreamHandle = { controller: ReadableStreamDefaultController<Uint8Array> | null }

/** A server whose stream sends what the test pushes, and ends once it is told. */
const streamingServer = ({ status = HTTP_STATUSES.ok }: StreamingServerProps = {}) => {
  const asked: Asked[] = []
  const encoder = new TextEncoder()
  const stream: StreamHandle = { controller: null }
  const body = new ReadableStream<Uint8Array>({
    start: (controller) => {
      stream.controller = controller
    },
  })
  const fetch = async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
    asked.push({ url: String(url), init })
    return new Response(status === HTTP_STATUSES.ok ? body : null, { status })
  }
  return {
    asked,
    fetch: Object.assign(fetch, { preconnect: () => undefined }),
    push: (text: string) => stream.controller!.enqueue(encoder.encode(text)),
    end: () => stream.controller!.close(),
  }
}

type Heard = { type: string; data: unknown }

const listen = (source: ReturnType<typeof fetchEventSource>) => {
  const heard: Heard[] = []
  Object.values(SERVER_STREAM_EVENTS).forEach((type) =>
    source.addEventListener(type, ({ data }) => heard.push({ type, data })),
  )
  return heard
}

describe('fetchEventSource', () => {
  it('opens the stream with the Bearer, and hands on each event as it arrives, in pieces or not', async () => {
    const server = streamingServer()
    const source = fetchEventSource({
      url: 'https://meleys.example/api/events',
      accessToken: 'token',
      fetch: server.fetch,
    })
    const heard = listen(source)
    await waitFor(() => expect(source.readyState).toBe(SERVER_STREAM_STATES.open))
    expect(server.asked[0]?.url ?? null).toBe('https://meleys.example/api/events')
    expect(new Headers(server.asked[0]?.init?.headers ?? {}).get(AUTH_HEADERS.authorization)).toBe(
      `${AUTH_SCHEME} token`,
    )
    server.push(': keep-alive\n\ndata: {"type":"bin')
    server.push('ge"}\r\n\r\ndata: one\ndata: two\n\n')
    await waitFor(() =>
      expect(heard).toEqual([
        { type: SERVER_STREAM_EVENTS.open, data: null },
        { type: SERVER_STREAM_EVENTS.message, data: '{"type":"binge"}' },
        { type: SERVER_STREAM_EVENTS.message, data: 'one\ntwo' },
      ]),
    )
  })

  it('says it gave up, closed, once the stream ends, so the hook opens another', async () => {
    const server = streamingServer()
    const source = fetchEventSource({ url: '/api/events', accessToken: null, fetch: server.fetch })
    const heard = listen(source)
    await waitFor(() => expect(source.readyState).toBe(SERVER_STREAM_STATES.open))
    expect(new Headers(server.asked[0]?.init?.headers ?? {}).has(AUTH_HEADERS.authorization)).toBe(
      false,
    )
    server.end()
    await waitFor(() => expect(source.readyState).toBe(SERVER_STREAM_STATES.closed))
    expect(heard.at(-1)).toEqual({ type: SERVER_STREAM_EVENTS.error, data: null })
  })

  it('gives up at once on a refusal', async () => {
    const server = streamingServer({ status: HTTP_STATUSES.unauthorized })
    const source = fetchEventSource({ url: '/api/events', accessToken: 'old', fetch: server.fetch })
    const heard = listen(source)
    await waitFor(() => expect(source.readyState).toBe(SERVER_STREAM_STATES.closed))
    expect(heard).toEqual([{ type: SERVER_STREAM_EVENTS.error, data: null }])
  })

  it('says nothing more once closed by the page', async () => {
    const server = streamingServer()
    const source = fetchEventSource({
      url: '/api/events',
      accessToken: 'token',
      fetch: server.fetch,
    })
    const heard = listen(source)
    await waitFor(() => expect(source.readyState).toBe(SERVER_STREAM_STATES.open))
    source.close()
    server.push('data: late\n\n')
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(source.readyState).toBe(SERVER_STREAM_STATES.closed)
    expect(heard).toEqual([{ type: SERVER_STREAM_EVENTS.open, data: null }])
  })
})
