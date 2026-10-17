import { isLockState } from '@raven/core'
import type { ServerEntry } from '@/main/desktopConfig'
import {
  isWrite,
  matchCall,
  requestFor,
  type AllowedCall,
  type ServerMethod,
} from '@/main/servers/allowlist'
import { SERVER_GONE } from '@/shared/protocol'

export const CALL_TIMEOUT_MS = 10_000
export const MAX_REPLY_CHARS = 1_048_576
export const MAX_IN_FLIGHT = 6
/** Slots past `MAX_IN_FLIGHT` that only a `PUT` or `POST` may take, so reads never starve a save or an unlock. */
export const WRITE_RESERVE = 2

export const CALL_MESSAGES = {
  unknownServer: SERVER_GONE,
  offList: 'raven player does not make that call.',
  unreachable: (name: string) => `raven player could not reach ${name}.`,
  tooBig: (name: string) => `${name} sent more than raven player reads.`,
  busy: (name: string) => `raven player is still waiting on ${name}.`,
} as const

export type ServerFetch = (input: {
  url: string
  method: ServerMethod
  headers: Record<string, string>
  body: string | null
  timeoutMs: number
}) => Promise<{ status: number; text: () => Promise<string> }>

export type ServerCallResult =
  | { ok: true; status: number; body: string }
  | { ok: false; message: string }

export type ServerCalls = {
  call: (input: { serverId: string; call: AllowedCall }) => Promise<ServerCallResult>
  callFromPage: (input: {
    serverId: string
    method: string
    path: string
    body: string | null
  }) => Promise<ServerCallResult>
  hasPendingWrites: () => boolean
  settleWrites: () => Promise<void>
}

/** Reads a reply's text, stopping one chunk past `MAX_REPLY_CHARS`, so a huge one is never held whole. */
const readCapped = async ({
  reader,
  decoder,
  text,
}: {
  reader: {
    read: () => Promise<{ done: true; value?: undefined } | { done: false; value: Uint8Array }>
    cancel: () => Promise<void>
  }
  decoder: TextDecoder
  text: string
}): Promise<string> => {
  const { done, value } = await reader.read()
  if (done) return `${text}${decoder.decode()}`
  const next = `${text}${decoder.decode(value, { stream: true })}`
  if (next.length <= MAX_REPLY_CHARS) return readCapped({ reader, decoder, text: next })
  await reader.cancel().catch(() => undefined)
  return next
}

/**
 * A `ServerFetch` over a session's `fetch`: the session's cookies go along, a redirect
 * fails the call rather than carrying them to wherever it points, and a call that
 * never answers is cut off.
 */
export const fetchThrough =
  (fetch: (url: string, init: RequestInit) => Promise<Response>): ServerFetch =>
  async ({ url, method, headers, body, timeoutMs }) => {
    const response = await fetch(url, {
      method,
      headers,
      ...(body === null ? {} : { body }),
      redirect: 'error',
      signal: AbortSignal.timeout(timeoutMs),
      credentials: 'include',
    })
    const stream = response.body
    return {
      status: response.status,
      text: () =>
        stream === null
          ? Promise.resolve('')
          : readCapped({ reader: stream.getReader(), decoder: new TextDecoder(), text: '' }),
    }
  }

const headersFor = ({ body }: { body: string | null }): Record<string, string> =>
  body === null
    ? { accept: 'application/json' }
    : { accept: 'application/json', 'content-type': 'application/json' }

const reasonOf = (error: unknown): string => (error instanceof Error ? error.message : 'unknown')

const LOG_TEXT_MAX = 200

// Controls, format characters (bidi overrides, zero widths), line and paragraph
// separators and lone surrogates could break a log line or disguise it.
const UNPRINTABLE = /[\p{Cc}\p{Cf}\p{Cs}\p{Zl}\p{Zp}]/gu

/** Text fit for one log line: unprintable characters escaped, the length bounded. */
export const loggable = (text: string): string =>
  text
    .slice(0, LOG_TEXT_MAX)
    .replace(UNPRINTABLE, (char) => `\\u{${(char.codePointAt(0) ?? 0).toString(16)}}`)

const parseJson = (text: string): { ok: true; value: unknown } | { ok: false } => {
  try {
    const value: unknown = JSON.parse(text)
    return { ok: true, value }
  } catch {
    return { ok: false }
  }
}

/** The call as `matchCall` reads its own request back, or null when it does not survive that. */
const rematch = (call: AllowedCall): AllowedCall | null => {
  try {
    return matchCall(requestFor(call))
  } catch {
    return null
  }
}

/**
 * Runs allowlisted calls against the stored servers. Every URL is the stored origin
 * plus the path `requestFor` builds, so nothing the page sends can name another host.
 */
export const createServerCalls = ({
  serverOf,
  fetchFor,
  warn,
}: {
  serverOf: (serverId: string) => ServerEntry | null
  fetchFor: (serverId: string) => ServerFetch
  warn: (message: string) => void
}): ServerCalls => {
  /** A log line never fails a call: the call has already been answered or refused. */
  const safeWarn = (message: string): void => {
    try {
      warn(message)
    } catch {
      // Nothing is left to tell.
    }
  }

  let inFlight: ReadonlyMap<string, number> = new Map()
  let writes: ReadonlySet<Promise<void>> = new Set()

  const countOf = (serverId: string): number => inFlight.get(serverId) ?? 0

  const adjust = ({ serverId, by }: { serverId: string; by: number }): void => {
    inFlight = new Map([...inFlight, [serverId, countOf(serverId) + by]])
  }

  const send = async ({
    server,
    call,
  }: {
    server: ServerEntry
    call: AllowedCall
  }): Promise<ServerCallResult> => {
    const { method, path, body } = requestFor(call)
    try {
      const reply = await fetchFor(server.id)({
        url: `${server.origin}${path}`,
        method,
        headers: headersFor({ body }),
        body,
        timeoutMs: CALL_TIMEOUT_MS,
      })
      const text = await reply.text()
      if (text.length > MAX_REPLY_CHARS) {
        safeWarn(`${loggable(server.name)} sent too much for ${method} ${path}`)
        return { ok: false, message: CALL_MESSAGES.tooBig(server.name) }
      }
      return { ok: true, status: reply.status, body: text }
    } catch (error) {
      safeWarn(`${method} ${path} to ${loggable(server.name)} failed: ${loggable(reasonOf(error))}`)
      return { ok: false, message: CALL_MESSAGES.unreachable(server.name) }
    }
  }

  const tracked = async ({
    task,
  }: {
    task: Promise<ServerCallResult>
  }): Promise<ServerCallResult> => {
    const settled = task.then(
      () => undefined,
      () => undefined,
    )
    writes = new Set([...writes, settled])
    try {
      return await task
    } finally {
      writes = new Set([...writes].filter((write) => write !== settled))
    }
  }

  /**
   * Main's own calls, from fields it narrowed itself. Anything the page sends goes
   * through `callFromPage`, never here; the call is still matched again, so a value
   * that slipped past the types (a string `mediaId`) never reaches a path.
   */
  const call: ServerCalls['call'] = async ({ serverId, call: given }) => {
    const allowed = rematch(given)
    if (allowed === null) {
      safeWarn('refused a call main built off the allowlist')
      return { ok: false, message: CALL_MESSAGES.offList }
    }
    const server = serverOf(serverId)
    if (server === null) return { ok: false, message: CALL_MESSAGES.unknownServer }
    const slots =
      requestFor(allowed).method === 'GET' ? MAX_IN_FLIGHT : MAX_IN_FLIGHT + WRITE_RESERVE
    if (countOf(serverId) >= slots) {
      return { ok: false, message: CALL_MESSAGES.busy(server.name) }
    }
    adjust({ serverId, by: 1 })
    try {
      const task = send({ server, call: allowed })
      return await (isWrite(allowed) ? tracked({ task }) : task)
    } finally {
      adjust({ serverId, by: -1 })
    }
  }

  const callFromPage: ServerCalls['callFromPage'] = async ({ serverId, method, path, body }) => {
    const allowed = matchCall({ method, path, body })
    if (allowed === null) {
      safeWarn(`refused a page call off the allowlist: ${loggable(method)} ${loggable(path)}`)
      return { ok: false, message: CALL_MESSAGES.offList }
    }
    return call({ serverId, call: allowed })
  }

  return {
    call,
    callFromPage,
    hasPendingWrites: () => writes.size > 0,
    settleWrites: async () => {
      await Promise.all(writes)
    },
  }
}

/** Whether `origin` answers as a raven server: a 200 from `GET /api/lock` holding a lock state. */
export const probeServer = async ({
  fetch,
  origin,
}: {
  fetch: ServerFetch
  origin: string
}): Promise<boolean> => {
  const { method, path, body } = requestFor({ name: 'getLock' })
  try {
    const reply = await fetch({
      url: `${origin}${path}`,
      method,
      headers: headersFor({ body }),
      body,
      timeoutMs: CALL_TIMEOUT_MS,
    })
    if (reply.status !== 200) return false
    const text = await reply.text()
    if (text.length > MAX_REPLY_CHARS) return false
    const parsed = parseJson(text)
    return parsed.ok && isLockState(parsed.value)
  } catch {
    return false
  }
}
