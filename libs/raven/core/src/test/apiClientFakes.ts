import { type FetchInit, type FetchResponse, createApiClient } from '@/apiClient'

/** One request the client made: where to, and how. */
export type Call = { url: string; init?: FetchInit }

type RespondProps = { status?: number; body?: unknown }

/** A server's answer with `body` as JSON and as text, `200` unless `status` says otherwise. */
export const respond = ({ status = 200, body }: RespondProps): FetchResponse => ({
  ok: status >= 200 && status < 300,
  status,
  statusText: status === 200 ? 'OK' : 'Error',
  json: async () => body,
  text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
})

/** A client on `http://nas:8484/` whose every request gets `response`, and the requests it made. */
export const clientReturning = (response: FetchResponse) => {
  const calls: Call[] = []
  const client = createApiClient({
    baseUrl: 'http://nas:8484/',
    fetch: async (url, init) => {
      calls.push({ url, init })
      return response
    },
  })
  return { client, calls }
}
