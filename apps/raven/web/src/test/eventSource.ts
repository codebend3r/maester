/**
 * happy-dom has no EventSource. This stands in for it, keeps every stream a
 * page opens, and lets a test send what the server would.
 */
export class FakeEventSource extends EventTarget {
  static opened: FakeEventSource[] = []
  readonly url: string
  closed = false

  constructor(url: string) {
    super()
    this.url = url
    FakeEventSource.opened.push(this)
  }

  close(): void {
    this.closed = true
  }

  /** What the server would send, as JSON. */
  send(data: unknown): void {
    this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(data) }))
  }
}

Object.defineProperty(globalThis, 'EventSource', { value: FakeEventSource, configurable: true })
