import { AUTH_HEADERS, AUTH_SCHEME } from '@raven/core'
import { CACHE_POLICIES } from '@shared/http'
import {
  SERVER_STREAM_EVENTS,
  SERVER_STREAM_STATES,
  type ServerEventSource,
} from '@/query/useServerEvents'

type StreamEvent = (typeof SERVER_STREAM_EVENTS)[keyof typeof SERVER_STREAM_EVENTS]

/** What a listener hears: the event's data, or null for one that carries none. */
type StreamMessage = { data: unknown }

type StreamListener = (event: StreamMessage) => void

/** The field a server-sent event's payload rides in, one line of it at a time. */
const DATA_FIELD = 'data:'

/** What ends one event and starts the next: a blank line, whichever line ending the server writes. */
const EVENT_END = /\r?\n\r?\n/

const LINE_END = /\r?\n/

/** An event's `data` lines joined as the spec joins them, or null for one with none (a comment, a keep-alive). */
const dataOf = (block: string): string | null => {
  const lines = block
    .split(LINE_END)
    .filter((line) => line.startsWith(DATA_FIELD))
    .map((line) => line.slice(DATA_FIELD.length).replace(/^ /, ''))
  return lines.length === 0 ? null : lines.join('\n')
}

type EventsInProps = {
  /** The part of an event that had not ended when the last piece was read. */
  pending: string
  text: string
  isDone: boolean
}

type EventsIn = { events: string[]; pending: string }

/**
 * The data of each whole event in what has arrived, in order, and the part still arriving, which
 * the next piece continues. A stream that is done has nothing still arriving: its last part is an
 * event too.
 */
const eventsIn = ({ pending, text, isDone }: EventsInProps): EventsIn => {
  const blocks = `${pending}${text}`.split(EVENT_END)
  const whole = isDone ? blocks : blocks.slice(0, -1)
  return {
    events: whole.map(dataOf).filter((data) => data !== null),
    pending: isDone ? '' : (blocks.at(-1) ?? ''),
  }
}

type EmitProps = { type: StreamEvent; data?: unknown }

type ReadProps = {
  reader: ReadableStreamDefaultReader<Uint8Array>
  decoder: TextDecoder
  pending: string
}

type FetchEventSourceProps = {
  url: string
  /** The Bearer the stream opens with; null opens it with none, which the server refuses. */
  accessToken: string | null
  fetch?: typeof globalThis.fetch
}

/**
 * A server's event stream read through `fetch`, for a server at another origin: `EventSource`
 * sends no headers, so it could carry only that origin's cookies, which the page has none of,
 * and this sends the account's Bearer. It answers as much of `EventSource` as the event hook
 * uses: `open` once the server answers, a `message` for each event's data, and, when the stream
 * fails or ends, one `error` with `readyState` closed, after which the hook opens another. It
 * never reconnects on its own.
 */
export const fetchEventSource = ({
  url,
  accessToken,
  fetch = globalThis.fetch,
}: FetchEventSourceProps): ServerEventSource => {
  const listeners = new Map<StreamEvent, Set<StreamListener>>()
  const controller = new AbortController()
  let readyState: number = SERVER_STREAM_STATES.connecting

  const emit = ({ type, data = null }: EmitProps): void =>
    (listeners.get(type) ?? new Set<StreamListener>()).forEach((listener) => listener({ data }))

  const finish = (): void => {
    if (readyState === SERVER_STREAM_STATES.closed) return
    readyState = SERVER_STREAM_STATES.closed
    emit({ type: SERVER_STREAM_EVENTS.error })
  }

  // Each read starts the next once it is in, so a stream open for hours chains nothing.
  const read = ({ reader, decoder, pending }: ReadProps): void => {
    reader
      .read()
      .then(({ done, value }) => {
        if (controller.signal.aborted) return
        const text = decoder.decode(value, { stream: !done })
        const arrived = eventsIn({ pending, text, isDone: done })
        arrived.events.forEach((data) => emit({ type: SERVER_STREAM_EVENTS.message, data }))
        if (done) return finish()
        read({ reader, decoder, pending: arrived.pending })
      })
      .catch(finish)
  }

  fetch(url, {
    headers:
      accessToken === null ? {} : { [AUTH_HEADERS.authorization]: `${AUTH_SCHEME} ${accessToken}` },
    cache: CACHE_POLICIES.noStore,
    signal: controller.signal,
  })
    .then((response) => {
      if (controller.signal.aborted) return
      if (!response.ok || response.body === null) return finish()
      readyState = SERVER_STREAM_STATES.open
      emit({ type: SERVER_STREAM_EVENTS.open })
      read({ reader: response.body.getReader(), decoder: new TextDecoder(), pending: '' })
    })
    .catch(finish)

  return {
    addEventListener: (type, listener) => {
      listeners.set(type, new Set([...(listeners.get(type) ?? []), listener]))
    },
    close: () => {
      readyState = SERVER_STREAM_STATES.closed
      controller.abort()
    },
    get readyState() {
      return readyState
    },
  }
}
