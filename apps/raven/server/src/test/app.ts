import { brotliDecompressSync, gunzipSync } from 'node:zlib'
import type { NestFastifyApplication } from '@nestjs/platform-fastify'
import { isRecord } from '@raven/core'
import { ENCODINGS, HEADERS, HTTP_METHODS } from '@shared/server'
import { type ServerConfig, readServerConfig } from '@/config'

export const ROUTE_METHODS = { ...HTTP_METHODS, put: 'PUT', delete: 'DELETE' } as const

export type RouteMethod = (typeof ROUTE_METHODS)[keyof typeof ROUTE_METHODS]

export const isRouteMethod = (value: string): value is RouteMethod =>
  Object.values(ROUTE_METHODS).some((method) => method === value)

/** A watcher that never fires, for tests that scan by hand. */
export const NOT_WATCHING = { watchFolder: () => ({ close: () => undefined }) }

type EventuallyProps<T> = {
  read: () => Promise<T>
  check: (value: T) => boolean
  ms?: number
}

/** Resolves with `read()` once `check` holds for it, polling, or fails after `ms`. */
export const eventually = async <T>({
  read,
  check,
  ms = 10_000,
}: EventuallyProps<T>): Promise<T> => {
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

/** A gate that holds a call until it is let go, and says once the call has reached it. */
export const holdOpen = () => {
  const gate = { open: () => {}, reach: () => {} }
  const opened = new Promise<void>((resolve) => {
    gate.open = resolve
  })
  const reached = new Promise<void>((resolve) => {
    gate.reach = resolve
  })
  return { gate, opened, reached }
}

type RoutePathProps = {
  route: string
  values: Record<string, string | number>
}

/** A route with its `:name` placeholders filled in from `values`, keyed by the names. */
export const routePath = ({ route, values }: RoutePathProps): string =>
  Object.entries(values).reduce(
    (path, [name, value]) => path.replace(`:${name}`, String(value)),
    route,
  )

/** What Chrome offers over https: the browser that reaches raven through Netlify. */
export const BROWSER_ENCODINGS = 'gzip, deflate, br, zstd'

type DecodedBodyProps = {
  headers: Record<string, unknown>
  rawPayload: Buffer
}

/** A response's body as a browser's fetch hands it over, unpacked from whatever it was sent in. */
export const decodedBody = (response: DecodedBodyProps): Buffer => {
  const encoding = response.headers[HEADERS.contentEncoding]
  if (encoding === ENCODINGS.br) return brotliDecompressSync(response.rawPayload)
  if (encoding === ENCODINGS.gzip) return gunzipSync(response.rawPayload)
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

type CookieSetProps = { headers: Record<string, unknown> }

/** The cookie a response sets, as a browser sends it back: its name and value, no attributes. */
export const cookieSet = (response: CookieSetProps): string => {
  const header = response.headers[HEADERS.setCookie]
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

type InjectAsProps = { app: NestFastifyApplication; cookie: string }

/**
 * `app.inject` as a browser holding `cookie` sends it: the cookie goes with
 * every request, as it goes with every call of `apiFor`'s client.
 */
export const injectAs =
  ({ app, cookie }: InjectAsProps) =>
  (options: InjectOptions) =>
    app.inject({ ...options, headers: { ...options.headers, cookie } })

/** Every cookie given, in one Cookie header. */
export const cookies = (...given: (string | undefined)[]): string =>
  given.filter((cookie) => !!cookie).join('; ')

type TestConfigProps = {
  dataDir: string
  mediaDir: string
  webDir?: string | null
}

/**
 * A test's server: no scan on start, no rescans, no intro detection in the
 * background, the CPU encoder, and the admin password above.
 */
export const testConfig = ({
  dataDir,
  mediaDir,
  webDir = null,
}: TestConfigProps): ServerConfig => ({
  ...readServerConfig({}),
  hwAccel: 'none',
  dataDir,
  webDir,
  browseRoot: mediaDir,
  scanOnStart: false,
  quickScanIntervalMinutes: 0,
  markerDetection: false,
  loudnessScan: false,
  adminPassword: ADMIN_PASSWORD,
})
