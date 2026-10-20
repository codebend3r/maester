import {
  AUTH_CONFIG_STATES,
  AUTH_HEADERS,
  AUTH_REFUSALS,
  AUTH_SCHEME,
  isAuthConfig,
  isLockState,
  type AuthConfig,
  type AuthRefusal,
} from '@raven/core'
import { signInConfigOf, type SignInConfig } from '@/main/accounts/authEndpoints'
import { accountIdOfToken } from '@/main/accounts/tokenAccount'
import type { ServerEntry } from '@/main/desktopConfig'
import { quietly } from '@/main/log/quietly'
import { parseJson } from '@/main/parseJson'
import {
  CALL_NAMES,
  isPageCall,
  isWrite,
  matchCall,
  requestFor,
  type AllowedCall,
  type ServerMethod,
} from '@/main/servers/allowlist'
import { refusalAt } from '@/main/servers/authRefusals'
import { AS_ANYONE, REPORT_KINDS, type TitleSittings } from '@/main/servers/titleSittings'
import { HTTP_HEADERS } from '@/shared/httpHeaders'
import { HTTP_STATUSES } from '@/shared/httpStatuses'
import { SERVER_GONE, SERVER_METHODS } from '@/shared/protocol'

export const CALL_TIMEOUT_MS = 10_000
export const MAX_REPLY_CHARS = 1_048_576
/** `getSagas` answers every saga of a library with a whole `MediaItem` per movie, so it reads past the usual cap. */
export const MAX_SAGAS_REPLY_CHARS = 8 * 1_048_576
export const MAX_IN_FLIGHT = 6
/** Slots past `MAX_IN_FLIGHT` that only a `PUT` or `POST` may take, so reads never starve a save or an unlock. */
export const WRITE_RESERVE = 2

export const CALL_MESSAGES = {
  unknownServer: SERVER_GONE,
  offList: 'raven player does not make that call.',
  adminWithAccounts: (name: string) =>
    `${name} uses accounts, so raven player does not use its admin password.`,
  unreachable: (name: string) => `raven player could not reach ${name}.`,
  tooBig: (name: string) => `${name} sent more than raven player reads.`,
  busy: (name: string) => `raven player is still waiting on ${name}.`,
  otherAccount: (name: string) => `raven player is signed in to ${name} as someone else now.`,
} as const

export type ServerFetch = (input: {
  url: string
  method: ServerMethod
  headers: Record<string, string>
  body: string | null
  timeoutMs: number
}) => Promise<{ status: number; text: (input: { maxChars: number }) => Promise<string> }>

export type ServerCallResult =
  | { ok: true; status: number; body: string }
  | { ok: false; message: string }

export type ServerCalls = {
  /**
   * `accountId`, when given, is the only account the call may go out as: one whose token names
   * another account, or no token, sends nothing.
   */
  call: (input: {
    serverId: string
    call: AllowedCall
    accountId?: string | null
  }) => Promise<ServerCallResult>
  callFromPage: (input: {
    serverId: string
    method: string
    path: string
    body: string | null
  }) => Promise<ServerCallResult>
  hasPendingWrites: () => boolean
  settleWrites: () => Promise<void>
}

/** Reads a reply's text, stopping one chunk past `maxChars`, so a huge one is never held whole. */
const readCapped = async ({
  reader,
  decoder,
  text,
  maxChars,
}: {
  reader: {
    read: () => Promise<{ done: true; value?: undefined } | { done: false; value: Uint8Array }>
    cancel: () => Promise<void>
  }
  decoder: TextDecoder
  text: string
  maxChars: number
}): Promise<string> => {
  const { done, value } = await reader.read()
  if (done) return `${text}${decoder.decode()}`
  const next = `${text}${decoder.decode(value, { stream: true })}`
  if (next.length <= maxChars) return readCapped({ reader, decoder, text: next, maxChars })
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

const headersFor = ({
  body,
  token = null,
}: {
  body: string | null
  token?: string | null
}): Record<string, string> => ({
  [HTTP_HEADERS.accept]: 'application/json',
  ...(body === null ? {} : { [HTTP_HEADERS.contentType]: 'application/json' }),
  ...(token === null ? {} : { [AUTH_HEADERS.authorization]: `${AUTH_SCHEME} ${token}` }),
})

/** How many characters of a call's reply main reads. */
export const replyCapFor = (call: AllowedCall): number =>
  call.name === CALL_NAMES.getSagas ? MAX_SAGAS_REPLY_CHARS : MAX_REPLY_CHARS

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

/** The account layer's part of every call. A server whose accounts are not ready answers `null`. */
export type Bearer = {
  /** The access token to send to the server, or null for a call that carries none. */
  authorize: (input: { serverId: string }) => Promise<string | null>
  /** Refreshes the sign-in after a `signed_out` refusal; the new access token, or null. */
  refresh: (input: { serverId: string }) => Promise<string | null>
  /**
   * A `401` or `503` that carries an auth refusal came back for good. `isSessionRejected` is true
   * when the token main had just refreshed was refused again.
   */
  onRefusal: (input: { serverId: string; isSessionRejected: boolean }) => void
  /**
   * Whether the server is kept as one whose accounts are ready, read from what main already holds
   * and never from the network. Enforcement replaces the admin password with the account there.
   */
  hasAccounts: (input: { serverId: string }) => boolean
}

/** For calls that never carry an account: main's own reads of a server's public auth config. */
export const NO_BEARER = {
  authorize: () => Promise.resolve(null),
  refresh: () => Promise.resolve(null),
  onRefusal: () => undefined,
  hasAccounts: () => false,
} as const satisfies Bearer

const BEARER_REFUSAL_STATUSES = [HTTP_STATUSES.unauthorized, HTTP_STATUSES.unavailable] as const

/** The refusal a `401` or `503` carries, so a wrong PIN's 401 or a proxy's 503 is none. */
const refusalReasonOf = (result: { status: number; body: string }): AuthRefusal['reason'] | null =>
  refusalAt({ ...result, statuses: BEARER_REFUSAL_STATUSES })

/** The call as `matchCall` reads its own request back, or null when it does not survive that. */
const rematch = (call: AllowedCall): AllowedCall | null => {
  try {
    return matchCall(requestFor(call))
  } catch {
    return null
  }
}

const isAdminPasswordCall = (call: AllowedCall): boolean =>
  call.name === CALL_NAMES.getAdminLock || call.name === CALL_NAMES.unlockAdmin

/** The title a call reports watching, or null for a call that reports nothing. */
const reportedTitleOf = (call: AllowedCall): number | null =>
  call.name === CALL_NAMES.saveProgress || call.name === CALL_NAMES.recordPlay ? call.mediaId : null

/**
 * Runs allowlisted calls against the stored servers. Every URL is the stored origin
 * plus the path `requestFor` builds, so nothing the page sends can name another host.
 */
export const createServerCalls = ({
  serverOf,
  fetchFor,
  authorize,
  refresh,
  onRefusal,
  hasAccounts,
  reportAs = () => AS_ANYONE,
  warn,
}: {
  serverOf: (serverId: string) => ServerEntry | null
  fetchFor: (serverId: string) => ServerFetch
  /**
   * Who the page's reports of a title go out as; main's own calls and the auth config reads
   * report nothing, so they leave it out.
   */
  reportAs?: TitleSittings['reportAs']
  warn: (message: string) => void
} & Bearer): ServerCalls => {
  /** A log line never fails a call: the call has already been answered or refused. */
  const safeWarn = quietly(warn)

  let inFlight: ReadonlyMap<string, number> = new Map()
  let writes: ReadonlySet<Promise<void>> = new Set()

  const countOf = (serverId: string): number => inFlight.get(serverId) ?? 0

  const adjust = ({ serverId, by }: { serverId: string; by: number }): void => {
    inFlight = new Map([...inFlight, [serverId, countOf(serverId) + by]])
  }

  const slotsFor = (call: AllowedCall): number =>
    requestFor(call).method === SERVER_METHODS.get ? MAX_IN_FLIGHT : MAX_IN_FLIGHT + WRITE_RESERVE

  const isBusy = ({ server, call }: { server: ServerEntry; call: AllowedCall }): boolean =>
    countOf(server.id) >= slotsFor(call)

  /**
   * One request to the server, in one of its slots. The slot is held for the request alone, not
   * for the Bearer's reads before it, so a slow Auth never fills the slots a ticket mint needs.
   */
  const attempt = async ({
    server,
    call,
    token,
  }: {
    server: ServerEntry
    call: AllowedCall
    token: string | null
  }): Promise<ServerCallResult> => {
    if (isBusy({ server, call })) return { ok: false, message: CALL_MESSAGES.busy(server.name) }
    adjust({ serverId: server.id, by: 1 })
    try {
      return await request({ server, call, token })
    } finally {
      adjust({ serverId: server.id, by: -1 })
    }
  }

  const request = async ({
    server,
    call,
    token,
  }: {
    server: ServerEntry
    call: AllowedCall
    token: string | null
  }): Promise<ServerCallResult> => {
    const { method, path, body } = requestFor(call)
    const maxChars = replyCapFor(call)
    try {
      const reply = await fetchFor(server.id)({
        url: `${server.origin}${path}`,
        method,
        headers: headersFor({ body, token }),
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

  const tokenFor = async (server: ServerEntry): Promise<string | null> => {
    try {
      return await authorize({ serverId: server.id })
    } catch {
      safeWarn(`raven player could not read its sign-in for ${loggable(server.name)}`)
      return null
    }
  }

  const refreshedFor = async (server: ServerEntry): Promise<string | null> => {
    try {
      return await refresh({ serverId: server.id })
    } catch {
      safeWarn(`raven player could not refresh its sign-in for ${loggable(server.name)}`)
      return null
    }
  }

  const announce = ({
    server,
    result,
    isSessionRejected,
  }: {
    server: ServerEntry
    result: Extract<ServerCallResult, { ok: true }>
    isSessionRejected: boolean
  }): void => {
    const reason = refusalReasonOf(result)
    if (reason === null) return
    try {
      onRefusal({
        serverId: server.id,
        isSessionRejected: isSessionRejected && reason === AUTH_REFUSALS.signedOut,
      })
    } catch {
      safeWarn(`raven player could not note a refusal from ${loggable(server.name)}`)
    }
  }

  const send = async ({
    server,
    call,
    accountId,
  }: {
    server: ServerEntry
    call: AllowedCall
    accountId: string | null
  }): Promise<ServerCallResult> => {
    // Checked against each token as it is read, so a sign in as another account in between never
    // carries one account's call under another's token.
    const isAs = (token: string | null): boolean =>
      accountId === null || (token !== null && accountIdOfToken(token) === accountId)
    const otherAccount: ServerCallResult = {
      ok: false,
      message: CALL_MESSAGES.otherAccount(server.name),
    }
    const token = await tokenFor(server)
    if (!isAs(token)) return otherAccount
    const first = await attempt({ server, call, token })
    if (!first.ok) return first
    const isRefreshable =
      token !== null &&
      first.status === HTTP_STATUSES.unauthorized &&
      refusalReasonOf(first) === AUTH_REFUSALS.signedOut
    if (!isRefreshable) {
      announce({ server, result: first, isSessionRejected: false })
      return first
    }
    const fresh = await refreshedFor(server)
    if (fresh === null) {
      announce({ server, result: first, isSessionRejected: false })
      return first
    }
    if (!isAs(fresh)) return otherAccount
    const second = await attempt({ server, call, token: fresh })
    if (second.ok) announce({ server, result: second, isSessionRejected: true })
    return second
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
  const call: ServerCalls['call'] = async ({ serverId, call: given, accountId = null }) => {
    const allowed = rematch(given)
    if (allowed === null) {
      safeWarn('refused a call main built off the allowlist')
      return { ok: false, message: CALL_MESSAGES.offList }
    }
    const server = serverOf(serverId)
    if (server === null) return { ok: false, message: CALL_MESSAGES.unknownServer }
    if (isAdminPasswordCall(allowed) && hasAccounts({ serverId })) {
      safeWarn(
        `refused ${allowed.name} to ${loggable(server.name)}: its accounts replace the admin password`,
      )
      return { ok: false, message: CALL_MESSAGES.adminWithAccounts(server.name) }
    }
    // A server already full answers at once, before the Bearer waits on Auth for nothing.
    if (isBusy({ server, call: allowed })) {
      return { ok: false, message: CALL_MESSAGES.busy(server.name) }
    }
    const task = send({ server, call: allowed, accountId })
    return isWrite(allowed) ? tracked({ task }) : task
  }

  const callFromPage: ServerCalls['callFromPage'] = async ({ serverId, method, path, body }) => {
    const allowed = matchCall({ method, path, body })
    if (allowed === null || !isPageCall(allowed)) {
      safeWarn(`refused a page call off the allowlist: ${loggable(method)} ${loggable(path)}`)
      return { ok: false, message: CALL_MESSAGES.offList }
    }
    const mediaId = reportedTitleOf(allowed)
    const as = mediaId === null ? AS_ANYONE : reportAs({ serverId, mediaId })
    switch (as.kind) {
      case REPORT_KINDS.anyone:
        return call({ serverId, call: allowed })
      // The token's own account is checked, so a sign in by another sends this title nothing.
      case REPORT_KINDS.account:
        return call({ serverId, call: allowed, accountId: as.accountId })
      case REPORT_KINDS.nobody: {
        const server = serverOf(serverId)
        return {
          ok: false,
          message:
            server === null ? CALL_MESSAGES.unknownServer : CALL_MESSAGES.otherAccount(server.name),
        }
      }
      default: {
        const unreachable: never = as
        return unreachable
      }
    }
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

export const PROBE_KINDS = {
  raven: 'raven',
  badSignIn: 'badSignIn',
  unreachable: 'unreachable',
} as const

/**
 * What a probe made of an origin. A raven server brings the sign-in endpoints to pin when its
 * accounts are ready, and none when they are off, unavailable or the server predates them.
 */
export type ProbeResult =
  | { kind: typeof PROBE_KINDS.raven; signIn: SignInConfig | null }
  | { kind: typeof PROBE_KINDS.badSignIn }
  | { kind: typeof PROBE_KINDS.unreachable }

/** A call's status and, when the reply is no bigger than the cap, its text; null when it failed. */
const probeCall = async ({
  fetch,
  origin,
  call,
}: {
  fetch: ServerFetch
  origin: string
  call: AllowedCall
}): Promise<{ status: number; text: string | null } | null> => {
  const { method, path, body } = requestFor(call)
  try {
    const reply = await fetch({
      url: `${origin}${path}`,
      method,
      headers: headersFor({ body }),
      body,
      timeoutMs: CALL_TIMEOUT_MS,
    })
    if (reply.status !== HTTP_STATUSES.ok) return { status: reply.status, text: null }
    const text = await reply.text({ maxChars: MAX_REPLY_CHARS })
    return { status: reply.status, text: text.length > MAX_REPLY_CHARS ? null : text }
  } catch {
    return null
  }
}

const isLockAnswer = (answer: Awaited<ReturnType<typeof probeCall>>): boolean => {
  if (answer === null || answer.status !== HTTP_STATUSES.ok || answer.text === null) return false
  return isLockState(parseJson(answer.text))
}

const UNREACHABLE: ProbeResult = { kind: PROBE_KINDS.unreachable }

const resultOf = (config: AuthConfig): ProbeResult => {
  if (config.state !== AUTH_CONFIG_STATES.ready) return { kind: PROBE_KINDS.raven, signIn: null }
  const signIn = signInConfigOf(config)
  return signIn === null ? { kind: PROBE_KINDS.badSignIn } : { kind: PROBE_KINDS.raven, signIn }
}

/**
 * Whether `origin` answers as a raven server, from its public `GET /api/auth/config`. A valid
 * config is a raven server; a 404 is one older than accounts, which `GET /api/lock` tells from
 * any other site; anything else is unreachable.
 */
export const probeServer = async ({
  fetch,
  origin,
}: {
  fetch: ServerFetch
  origin: string
}): Promise<ProbeResult> => {
  const answer = await probeCall({ fetch, origin, call: { name: CALL_NAMES.getAuthConfig } })
  if (answer === null) return UNREACHABLE
  if (answer.status === HTTP_STATUSES.notFound) {
    const lock = await probeCall({ fetch, origin, call: { name: CALL_NAMES.getLock } })
    return isLockAnswer(lock) ? { kind: PROBE_KINDS.raven, signIn: null } : UNREACHABLE
  }
  if (answer.status !== HTTP_STATUSES.ok || answer.text === null) return UNREACHABLE
  const parsed = parseJson(answer.text)
  return isAuthConfig(parsed) ? resultOf(parsed) : UNREACHABLE
}
