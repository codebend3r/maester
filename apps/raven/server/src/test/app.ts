import { brotliDecompressSync, gunzipSync } from 'node:zlib'
import type { NestFastifyApplication } from '@nestjs/platform-fastify'
import { isRecord } from '@raven/core'
import { type ServerConfig, readServerConfig } from '@/config'

export const ROUTE_METHODS = ['GET', 'POST', 'PUT', 'DELETE'] as const

export const isRouteMethod = (value: string): value is (typeof ROUTE_METHODS)[number] =>
  ROUTE_METHODS.some((method) => method === value)

/** A watcher that never fires, for tests that scan by hand. */
export const NOT_WATCHING = { watchFolder: () => ({ close: () => undefined }) }

/** Resolves with `read()` once `check` holds for it, polling, or fails after `ms`. */
export const eventually = async <T>({
  read,
  check,
  ms = 10_000,
}: {
  read: () => Promise<T>
  check: (value: T) => boolean
  ms?: number
}): Promise<T> => {
  const until = Date.now() + ms
  const poll = async (): Promise<T> => {
    const value = await read()
    if (check(value)) return value
    if (Date.now() > until) throw new Error(`timed out waiting: ${JSON.stringify(value)}`)
    await new Promise((resolve) => setTimeout(resolve, 50))
    return poll()
  }
  return poll()
}

/** What Chrome offers over https: the browser that reaches raven through Netlify. */
export const BROWSER_ENCODINGS = 'gzip, deflate, br, zstd'

/** A response's body as a browser's fetch hands it over, unpacked from whatever it was sent in. */
export const decodedBody = (response: {
  headers: Record<string, unknown>
  rawPayload: Buffer
}): Buffer => {
  const encoding = response.headers['content-encoding']
  if (encoding === 'br') return brotliDecompressSync(response.rawPayload)
  if (encoding === 'gzip') return gunzipSync(response.rawPayload)
  if (encoding === undefined) return response.rawPayload
  throw new Error(`Answered in ${String(encoding)}, which no browser asked for`)
}

/** Every key anywhere in a parsed JSON body. */
export const keysOf = (value: unknown): string[] => {
  if (Array.isArray(value)) return value.flatMap(keysOf)
  if (!isRecord(value)) return []
  return Object.entries(value).flatMap(([key, field]) => [key, ...keysOf(field)])
}

/** Strong enough for the admin lock, so the tests' servers can turn it off. */
export const ADMIN_PASSWORD = 'Raven-Admin-2026'

/** The cookie a response sets, as a browser sends it back: its name and value, no attributes. */
export const cookieSet = (response: { headers: Record<string, unknown> }): string => {
  const header = response.headers['set-cookie']
  return typeof header === 'string' ? (header.split(';')[0] ?? '') : ''
}

/** Turns the admin lock off with the password, as Settings does, for the cookie a browser keeps. */
export const adminCookie = async (app: NestFastifyApplication): Promise<string> =>
  cookieSet(
    await app.inject({
      method: 'POST',
      url: '/api/admin/unlock',
      payload: { password: ADMIN_PASSWORD },
    }),
  )

/** One request by hand, as `app.inject` takes it. */
export type InjectOptions = Exclude<Parameters<NestFastifyApplication['inject']>[0], string>

/**
 * `app.inject` as a browser holding `cookie` sends it: the cookie goes with
 * every request, as it goes with every call of `apiFor`'s client.
 */
export const injectAs =
  ({ app, cookie }: { app: NestFastifyApplication; cookie: string }) =>
  (options: InjectOptions) =>
    app.inject({ ...options, headers: { ...options.headers, cookie } })

/** Every cookie given, in one Cookie header. */
export const cookies = (...given: (string | undefined)[]): string =>
  given.filter((cookie) => !!cookie).join('; ')

/** A test's server: no scan on start, no rescans, the CPU encoder, and the admin password above. */
export const testConfig = ({
  dataDir,
  mediaDir,
  webDir = null,
}: {
  dataDir: string
  mediaDir: string
  webDir?: string | null
}): ServerConfig => ({
  ...readServerConfig({}),
  hwAccel: 'none',
  dataDir,
  webDir,
  browseRoot: mediaDir,
  scanOnStart: false,
  quickScanIntervalMinutes: 0,
  adminPassword: ADMIN_PASSWORD,
})
