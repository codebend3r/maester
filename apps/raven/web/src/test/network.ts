/**
 * Unit tests have no server. happy-dom's fetch opens a socket to the page's
 * own localhost:8484 for any call a test leaves unmocked, and prints the
 * refused connection. This one never answers, as a server that has not
 * replied yet, and fails as the browser's does once its request is aborted.
 * A test that needs an answer mocks the `api` call, or `fetch` itself.
 */
const unanswered = (_input: RequestInfo | URL, init?: RequestInit): Promise<Response> =>
  new Promise((_resolve, reject) => {
    const signal = init?.signal ?? null
    if (signal == null) return
    if (signal.aborted) {
      reject(signal.reason)
      return
    }
    signal.addEventListener('abort', () => reject(signal.reason), { once: true })
  })

Object.defineProperty(globalThis, 'fetch', {
  value: unanswered,
  configurable: true,
  writable: true,
})
