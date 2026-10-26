import {
  APP_CALL_METHODS,
  APP_CLIENT_CALLS,
  type ApiClient,
  MEDIA_ORIGIN_KINDS,
  MEDIA_PROBE_BYTES,
  type MediaOrigin,
  SERVER_COOKIES,
  appClientCallOf,
  createApiClient,
} from '@raven/core'

import { allowlistedFetch } from '@/servers/allowlist'
import type { ProbeFetch, WatchNetwork } from '@/servers/mediaAccess'
import type { ServerCookies } from '@/servers/cookieJar'
import { type Answer, NOT_FOUND, STATUSES, responseOf } from '@/test/fixtureFetch'
import { NAS } from '@/test/homeServer'

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

type MediaServerProps = {
  origins?: readonly MediaOrigin[]
  originsStatus?: number
  tickets?: readonly number[]
}

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
}: MediaServerProps): { api: ApiClient; heard: string[] } => {
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
      fetch: async (url) => {
        heard.push(url.slice(NAS.origin.length))
        return responseOf(answer(url))
      },
    }),
  })
  return { api, heard }
}

type ProbesOfProps = {
  elapsedMs: Readonly<Record<string, number>>
}

/**
 * Each origin's ping as long as `elapsedMs` names, in milliseconds; one it leaves out never
 * answers. `retime` sets new times, as a move to another network would. `probed` is every ping
 * address asked for, in order.
 */
export const probesOf = ({
  elapsedMs,
}: ProbesOfProps): {
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
