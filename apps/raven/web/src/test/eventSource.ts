import { EVENT_SOURCE_EVENTS } from '@/lib/eventSourceEvents'

/**
 * happy-dom has no EventSource. This stands in for it, keeps every stream a
 * page opens, and lets a test send what the server would.
 */
export class FakeEventSource extends EventTarget {
  static readonly CONNECTING = 0
  static readonly OPEN = 1
  static readonly CLOSED = 2
  static opened: FakeEventSource[] = []
  readonly url: string
  closed = false
  readyState = FakeEventSource.CONNECTING

  constructor(url: string) {
    super()
    this.url = url
    FakeEventSource.opened.push(this)
  }

  close(): void {
    this.closed = true
    this.readyState = FakeEventSource.CLOSED
  }

  /** What the server would send, as JSON. */
  send(data: unknown): void {
    this.dispatchEvent(
      new MessageEvent(EVENT_SOURCE_EVENTS.message, { data: JSON.stringify(data) }),
    )
  }

  /** The stream dropping, then the browser reconnecting. */
  reconnect(): void {
    this.readyState = FakeEventSource.CONNECTING
    this.dispatchEvent(new Event(EVENT_SOURCE_EVENTS.error))
    this.readyState = FakeEventSource.OPEN
    this.dispatchEvent(new Event(EVENT_SOURCE_EVENTS.open))
  }

  /** The browser giving up, as Chrome does when a reconnect is refused with a 401: closed, and no retry. */
  end(): void {
    this.readyState = FakeEventSource.CLOSED
    this.dispatchEvent(new Event(EVENT_SOURCE_EVENTS.error))
  }
}

Object.defineProperty(globalThis, 'EventSource', { value: FakeEventSource, configurable: true })
