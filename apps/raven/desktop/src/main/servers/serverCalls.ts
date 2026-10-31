import { AUTH_HEADERS, AUTH_SCHEME, SERVER_METHODS } from '@raven/core'
import { accountIdOfToken } from '@/main/accounts/tokenAccount'
import { SERVER_GONE, type ServerEntry } from '@/main/desktopConfig'
import { quietly } from '@/main/log/quietly'
import {
  CALL_NAMES,
  isWrite,
  matchCall,
  requestFor,
  type AllowedCall,
  type ServerMethod,
} from '@/main/servers/allowlist'
import { HTTP_HEADERS } from '@/shared/httpHeaders'

export const CALL_TIMEOUT_MS = 10_000
export const MAX_REPLY_CHARS = 1_048_576
/**
 * `getSagas` answers every saga of a library with a whole `MediaItem` per movie, and `getPlaylist`
 * a whole `Track` per track of up to 5000, so they read past the usual cap.
 */
export const MAX_LONG_REPLY_CHARS = 8 * 1_048_576

const LONG_REPLY_CALLS: ReadonlySet<AllowedCall['name']> = new Set([
  CALL_NAMES.getSagas,
  CALL_NAMES.getPlaylist,
])
export const MAX_IN_FLIGHT = 6
/** Slots past `MAX_IN_FLIGHT` that only a `PUT` or `POST` may take, so reads never starve a save or a ticket. */
export const WRITE_RESERVE = 2

export const CALL_MESSAGES = {
  unknownServer: SERVER_GONE,
  offList: 'Raven does not make that call.',
  unreachable: (name: string) => `Raven could not reach ${name}.`,
  tooBig: (name: string) => `${name} sent more than Raven reads.`,
  busy: (name: string) => `Raven is still waiting on ${name}.`,
  otherAccount: (name: string) => `Raven is signed in to ${name} as someone else now.`,
} as const

type ServerFetchProps = {
  url: string
  method: ServerMethod
  headers: Record<string, string>
  body: string | null
  timeoutMs: number
}

type TextProps = { maxChars: number }

export type ServerFetch = (
  input: ServerFetchProps,
) => Promise<{ status: number; text: (input: TextProps) => Promise<string> }>

export type ServerCallResult =
  | { ok: true; status: number; body: string }
  | { ok: false; message: string }

type CallProps = {
  serverId: string
  call: AllowedCall
  accountId?: string | null
}

export type ServerCalls = {
  /**
   * `accountId`, when given, is the only account the call may go out as: one whose token names
   * another account, or no token, sends nothing.
   */
  call: (input: CallProps) => Promise<ServerCallResult>
  hasPendingWrites: () => boolean
  settleWrites: () => Promise<void>
}

type ReadCappedProps = {
  reader: {
    read: () => Promise<{ done: true; value?: undefined } | { done: false; value: Uint8Array }>
    cancel: () => Promise<void>
  }
  decoder: TextDecoder
  text: string
  maxChars: number
}

/** Reads a reply's text, stopping one chunk past `maxChars`, so a huge one is never held whole. */
const readCapped = async ({
  reader,
  decoder,
  text,
  maxChars,
}: ReadCappedProps): Promise<string> => {
  const { done, value } = await reader.read()
  if (done) return `${text}${decoder.decode()}`
  const next = `${text}${decoder.decode(value, { stream: true })}`
  if (next.length <= maxChars) return readCapped({ reader, decoder, text: next, maxChars })
  await reader.cancel().catch(() => undefined)
  return next
}

/**
 * A `ServerFetch` over `net.fetch`: no cookie from any jar goes along, only the headers the call
 * names, a redirect fails the call rather than carrying them to wherever it points, and a call
 * that never answers is cut off.
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
      credentials: 'omit',
    })
    const stream = response.body
    return {
      status: response.status,
      text: ({ maxChars }) =>
        stream === null
          ? Promise.resolve('')
          : readCapped({
              reader: stream.getReader(),
              decoder: new TextDecoder(),
              text: '',
              maxChars,
            }),
    }
  }

type HeadersForProps = {
  body: string | null
  token: string | null
  unlock: string | null
}

const headersFor = ({ body, token, unlock }: HeadersForProps): Record<string, string> => ({
  [HTTP_HEADERS.accept]: 'application/json',
  ...(body === null ? {} : { [HTTP_HEADERS.contentType]: 'application/json' }),
  ...(token === null ? {} : { [AUTH_HEADERS.authorization]: `${AUTH_SCHEME} ${token}` }),
  ...(unlock === null ? {} : { [AUTH_HEADERS.cookie]: unlock }),
})

/** How many characters of a call's reply main reads. */
export const replyCapFor = (call: AllowedCall): number =>
  LONG_REPLY_CALLS.has(call.name) ? MAX_LONG_REPLY_CHARS : MAX_REPLY_CHARS

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

/** The call as `matchCall` reads its own request back, or null when it does not survive that. */
const rematch = (call: AllowedCall): AllowedCall | null => {
  try {
    return matchCall(requestFor(call))
  } catch {
    return null
  }
}

type AuthorizeProps = { serverId: string }

type UnlockOfProps = { serverId: string }

type CreateServerCallsProps = {
  serverOf: (serverId: string) => ServerEntry | null
  fetch: ServerFetch
  /** The access token to send to the server: the page's, or null while it is signed out. */
  authorize: (input: AuthorizeProps) => string | null
  /** The `Cookie` header with the page's unlock for the server, or null when it holds none. */
  unlockOf: (input: UnlockOfProps) => Promise<string | null>
  warn: (message: string) => void
}

/**
 * Runs allowlisted calls against the server. Every URL is its stored origin plus the path
 * `requestFor` builds, and each carries the page's access token as its Bearer when there is one,
 * and the page's library PIN unlock as its cookie when the page holds one.
 */
export const createServerCalls = ({
  serverOf,
  fetch,
  authorize,
  unlockOf,
  warn,
}: CreateServerCallsProps): ServerCalls => {
  /** A log line never fails a call: the call has already been answered or refused. */
  const safeWarn = quietly(warn)

  let inFlight: ReadonlyMap<string, number> = new Map()
  let writes: ReadonlySet<Promise<void>> = new Set()

  const countOf = (serverId: string): number => inFlight.get(serverId) ?? 0

  type AdjustProps = { serverId: string; by: number }

  const adjust = ({ serverId, by }: AdjustProps): void => {
    inFlight = new Map([...inFlight, [serverId, countOf(serverId) + by]])
  }

  const slotsFor = (call: AllowedCall): number =>
    requestFor(call).method === SERVER_METHODS.get ? MAX_IN_FLIGHT : MAX_IN_FLIGHT + WRITE_RESERVE

  type IsBusyProps = { server: ServerEntry; call: AllowedCall }

  const isBusy = ({ server, call }: IsBusyProps): boolean => countOf(server.id) >= slotsFor(call)

  type AttemptProps = {
    server: ServerEntry
    call: AllowedCall
    token: string | null
  }

  /** One request to the server, in one of its slots. */
  const attempt = async ({ server, call, token }: AttemptProps): Promise<ServerCallResult> => {
    if (isBusy({ server, call })) return { ok: false, message: CALL_MESSAGES.busy(server.name) }
    adjust({ serverId: server.id, by: 1 })
    try {
      return await request({ server, call, token })
    } finally {
      adjust({ serverId: server.id, by: -1 })
    }
  }

  type RequestProps = {
    server: ServerEntry
    call: AllowedCall
    token: string | null
  }

  const request = async ({ server, call, token }: RequestProps): Promise<ServerCallResult> => {
    const { method, path, body } = requestFor(call)
    const maxChars = replyCapFor(call)
    try {
      const unlock = await unlockOf({ serverId: server.id })
      const reply = await fetch({
        url: `${server.origin}${path}`,
        method,
        headers: headersFor({ body, token, unlock }),
        body,
        timeoutMs: CALL_TIMEOUT_MS,
      })
      const text = await reply.text({ maxChars })
      if (text.length > maxChars) {
        safeWarn(`${loggable(server.name)} sent too much for ${method} ${path}`)
        return { ok: false, message: CALL_MESSAGES.tooBig(server.name) }
      }
      return { ok: true, status: reply.status, body: text }
    } catch (error) {
      safeWarn(`${method} ${path} to ${loggable(server.name)} failed: ${loggable(reasonOf(error))}`)
      return { ok: false, message: CALL_MESSAGES.unreachable(server.name) }
    }
  }

  type SendProps = {
    server: ServerEntry
    call: AllowedCall
    accountId: string | null
  }

  /**
   * Checked against the token's own account, so a call that belongs to one account never goes
   * out under another's token, or under none.
   */
  const send = ({ server, call, accountId }: SendProps): Promise<ServerCallResult> => {
    const token = authorize({ serverId: server.id })
    const isAs = accountId === null || (token !== null && accountIdOfToken(token) === accountId)
    if (!isAs) {
      return Promise.resolve({ ok: false, message: CALL_MESSAGES.otherAccount(server.name) })
    }
    return attempt({ server, call, token })
  }

  type TrackedProps = {
    task: Promise<ServerCallResult>
  }

  const tracked = async ({ task }: TrackedProps): Promise<ServerCallResult> => {
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
   * Main's own calls, from fields it narrowed itself. The call is still matched again, so a
   * value that slipped past the types (a string `mediaId`) never reaches a path.
   */
  const call: ServerCalls['call'] = async ({ serverId, call: given, accountId = null }) => {
    const allowed = rematch(given)
    if (allowed === null) {
      safeWarn('refused a call main built off the allowlist')
      return { ok: false, message: CALL_MESSAGES.offList }
    }
    const server = serverOf(serverId)
    if (server === null) return { ok: false, message: CALL_MESSAGES.unknownServer }
    const task = send({ server, call: allowed, accountId })
    return isWrite(allowed) ? tracked({ task }) : task
  }

  return {
    call,
    hasPendingWrites: () => writes.size > 0,
    settleWrites: async () => {
      await Promise.all(writes)
    },
  }
}
