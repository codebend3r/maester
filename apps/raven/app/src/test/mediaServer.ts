import {
  APP_CALL_METHODS,
  APP_CLIENT_CALLS,
  AUTH_HEADERS,
  type ApiClient,
  type AuthRefusal,
  MEDIA_ORIGIN_KINDS,
  MEDIA_PROBE_BYTES,
  type MediaOrigin,
  SERVER_COOKIES,
  appClientCallOf,
  createApiClient,
} from '@raven/core'

import { allowlistedFetch } from '@/servers/allowlist'
import { createCookieJar } from '@/servers/cookieJar'
import type { ProbeFetch, WatchNetwork } from '@/servers/mediaAccess'
import type { ServerCookies } from '@/servers/cookieJar'
import { type NativeFetch, type ServerBearer, serverFetchFor } from '@/servers/serverFetch'
import { type Answer, NOT_FOUND, STATUSES, responseOf } from '@/test/fixtureFetch'
import { NAS } from '@/test/homeServer'
import { memoryStore } from '@/test/memoryStore'

/** The NAS's address on the home network, and its public one. */
export const LAN: MediaOrigin = { kind: MEDIA_ORIGIN_KINDS.lan, url: 'http://192.168.1.20:8080' }
export const PUBLIC: MediaOrigin = { kind: MEDIA_ORIGIN_KINDS.public, url: 'https://nas.example' }

/** The tickets the test server hands out, in turn. */
export const TICKETS = ['tkt.first', 'tkt.second', 'tkt.third'] as const

/** The NAS's PIN cookie, which the jar holds. */
export const NAS_COOKIES: ServerCookies = { [SERVER_COOKIES.unlock]: 'u.1' }

const refusalOf = (status: number): Answer => ({
  status,
  body: { message: status === STATUSES.locked ? 'This library is locked.' : 'No ticket.' },
})

/**
 * The NAS as `apiFor` reaches it, through the app's allowlist: `getMediaOrigins` lists `origins`
 * (or refuses with `originsStatus`), and each ticket read answers the next status of `tickets`,
 * 200 handing out the next of `TICKETS` and the last status standing for every read after it.
 * `heard` is every path it was asked for, in order.
 */
export const mediaServer = ({
  origins = [LAN, PUBLIC],
  originsStatus = STATUSES.ok,
  tickets = [STATUSES.ok],
}: {
  origins?: readonly MediaOrigin[]
  originsStatus?: number
  tickets?: readonly number[]
}): { api: ApiClient; heard: string[] } => {
  const heard: string[] = []
  let ticketReads = 0
  let issued = 0
  const ticketAnswer = (): Answer => {
    const status = tickets[Math.min(ticketReads, tickets.length - 1)] ?? STATUSES.ok
    ticketReads += 1
    if (status !== STATUSES.ok) return refusalOf(status)
    const ticket = TICKETS[Math.min(issued, TICKETS.length - 1)]
    issued += 1
    return { status, body: { ticket, expiresAt: 0 } }
  }
  const answer = (url: string): Answer => {
    const name = appClientCallOf({ method: APP_CALL_METHODS.get, url })
    const call = name === null ? null : APP_CLIENT_CALLS[name]
    if (call === APP_CLIENT_CALLS.getMediaTicket) return ticketAnswer()
    if (call !== APP_CLIENT_CALLS.getMediaOrigins) return NOT_FOUND
    return originsStatus === STATUSES.ok
      ? { status: originsStatus, body: { origins } }
      : refusalOf(originsStatus)
  }
  const api = createApiClient({
    baseUrl: NAS.origin,
    fetch: allowlistedFetch({
      hasAccounts: () => false,
      fetch: async (url) => {
        heard.push(url.slice(NAS.origin.length))
        return responseOf(answer(url))
      },
    }),
  })
  return { api, heard }
}

/** The account tickets the test server mints, in turn. */
export const ACCOUNT_TICKETS = ['account.first', 'account.second', 'account.third'] as const

/** The account's token as signed in, and the one a refresh hands out. */
export const ACCOUNT_TOKENS = { signedIn: 'token.signed-in', refreshed: 'token.refreshed' } as const

/** How the server answers one mint: a ticket, or a refusal with the reason its body gives. */
export type Mint =
  | { status: typeof STATUSES.ok }
  | { status: number; reason: AuthRefusal['reason'] | null }

const MINTED: Mint = { status: STATUSES.ok }

/**
 * The NAS with accounts `ready`, as `apiFor` reaches it: the account's Bearer on every call to its
 * own API, refreshed once when the server refuses it as `signed_out`, as `serverFetchFor` does.
 * `getMediaOrigins` lists `origins`, and each mint answers the next of `mints`, the last one
 * standing for every mint after it. `heard` is every path it was asked for, in order, and
 * `bearers` the Bearer each mint carried; `rejections` counts the sign outs a second refusal made.
 */
export const accountServer = ({
  origins = [LAN, PUBLIC],
  mints = [MINTED],
}: {
  origins?: readonly MediaOrigin[]
  mints?: readonly Mint[]
}) => {
  const heard: string[] = []
  const bearers: (string | null)[] = []
  const state: { token: string; minted: number; issued: number; rejections: number } = {
    token: ACCOUNT_TOKENS.signedIn,
    minted: 0,
    issued: 0,
    rejections: 0,
  }
  const bearer: ServerBearer = {
    token: async () => state.token,
    refresh: async () => {
      state.token = ACCOUNT_TOKENS.refreshed
      return state.token
    },
    rejected: async () => {
      state.rejections += 1
    },
  }
  const mintAnswer = (): Answer => {
    const mint = mints[Math.min(state.minted, mints.length - 1)] ?? MINTED
    state.minted += 1
    if (!('reason' in mint)) {
      const ticket = ACCOUNT_TICKETS[Math.min(state.issued, ACCOUNT_TICKETS.length - 1)]
      state.issued += 1
      return { status: mint.status, body: { ticket, expiresAt: 0 } }
    }
    return {
      status: mint.status,
      body: mint.reason === null ? { message: 'No.' } : { reason: mint.reason, message: 'No.' },
    }
  }
  const answer = ({ url, method }: { url: string; method: string }): Answer => {
    const name = appClientCallOf({ method, url })
    const call = name === null ? null : APP_CLIENT_CALLS[name]
    if (call === APP_CLIENT_CALLS.getAccountTicket) return mintAnswer()
    if (call === APP_CLIENT_CALLS.getMediaOrigins) return { status: STATUSES.ok, body: { origins } }
    return NOT_FOUND
  }
  const native: NativeFetch = async (url, init) => {
    const method = init.method ?? APP_CALL_METHODS.get
    heard.push(url.slice(NAS.origin.length))
    if (method !== APP_CALL_METHODS.get)
      bearers.push(init.headers?.[AUTH_HEADERS.authorization] ?? null)
    return { ...responseOf(answer({ url, method })), url, headers: { get: () => null } }
  }
  const api = createApiClient({
    baseUrl: NAS.origin,
    fetch: allowlistedFetch({
      hasAccounts: () => true,
      fetch: serverFetchFor({
        server: NAS,
        jar: createCookieJar({ store: memoryStore().store }),
        bearer,
        fetch: native,
      }),
    }),
  })
  return { api, heard, bearers, rejections: () => state.rejections }
}

/**
 * Each origin's ping as long as `elapsedMs` names, in milliseconds; one it leaves out never
 * answers. `retime` sets new times, as a move to another network would. `probed` is every ping
 * address asked for, in order.
 */
export const probesOf = ({
  elapsedMs,
}: {
  elapsedMs: Readonly<Record<string, number>>
}): {
  probe: ProbeFetch
  probed: string[]
  retime: (next: Readonly<Record<string, number>>) => void
} => {
  const probed: string[] = []
  let times = elapsedMs
  const probe: ProbeFetch = async ({ url }) => {
    probed.push(url)
    const origin = Object.keys(times).find((each) => url.startsWith(`${each}/`)) ?? null
    const elapsed = origin === null ? null : (times[origin] ?? null)
    if (elapsed === null) throw new TypeError('Network request failed')
    return { ok: true, bytes: MEDIA_PROBE_BYTES, elapsedMs: elapsed }
  }
  return {
    probe,
    probed,
    retime: (next) => {
      times = next
    },
  }
}

/** A network the test changes by hand: `change` tells every watcher, `watchers` counts them. */
export const fakeNetwork = (): {
  watchNetwork: WatchNetwork
  change: () => void
  watchers: () => number
} => {
  let listeners: ReadonlyArray<() => void> = []
  return {
    watchNetwork: ({ onChange }) => {
      listeners = [...listeners, onChange]
      return () => {
        listeners = listeners.filter((listener) => listener !== onChange)
      }
    },
    change: () => listeners.forEach((listener) => listener()),
    watchers: () => listeners.length,
  }
}
