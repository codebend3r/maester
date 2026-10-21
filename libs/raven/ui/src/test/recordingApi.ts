import { type FetchInit, createApiClient } from '@raven/core'

type Call = { url: string; init?: FetchInit }

/** An `ApiClient` whose every call is recorded and answered with `body`, as a server would. */
export const recordingApi = ({ body }: { body: unknown }) => {
  const calls: Call[] = []
  const api = createApiClient({
    fetch: async (url, init) => {
      calls.push({ url, init })
      return {
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => body,
        text: async () => JSON.stringify(body),
      }
    },
  })
  return { api, calls }
}
