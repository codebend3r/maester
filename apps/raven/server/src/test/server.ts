import type { NestFastifyApplication } from '@nestjs/platform-fastify'
import { type ApiClient, type FetchLike, createApiClient } from '@raven/core'

const METHODS = ['GET', 'POST', 'PUT', 'DELETE'] as const

type Method = (typeof METHODS)[number]

const isMethod = (value: string): value is Method => METHODS.some((method) => method === value)

/**
 * `fetch` for the API client, answered by the app in-process through
 * `inject`, so a test drives the real client against the real controllers
 * with no port. `cookie` goes with every request, as a browser's would.
 */
export const injectFetch =
  ({ app, cookie }: { app: NestFastifyApplication; cookie?: string }): FetchLike =>
  async (url, init = {}) => {
    const method = init.method ?? 'GET'
    if (!isMethod(method)) throw new Error(`The API client sent ${method}, which no route takes`)
    const response = await app.inject({
      method,
      url,
      headers: { ...init.headers, ...(cookie ? { cookie } : {}) },
      ...(init.body === undefined ? {} : { payload: init.body }),
    })
    return {
      ok: response.statusCode >= 200 && response.statusCode < 300,
      status: response.statusCode,
      statusText: response.statusMessage,
      json: async () => {
        const body: unknown = response.json()
        return body
      },
      text: async () => response.body,
    }
  }

/** The client every raven app uses, talking to `app` as a browser holding `cookie` would. */
export const apiFor = ({
  app,
  cookie,
}: {
  app: NestFastifyApplication
  cookie?: string
}): ApiClient => createApiClient({ fetch: injectFetch({ app, cookie }) })
