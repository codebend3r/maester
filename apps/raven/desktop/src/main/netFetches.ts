import type { FetchLike } from '@raven/core'
import { HTTP_METHODS } from '@shared/http'
import { net } from 'electron'
import type { StreamFetch } from '@/main/downloads/fetchFile'
import { OVERFLOWS, readCapped } from '@/main/servers/cappedBody'
import type { UpstreamFetch } from '@/main/servers/relayUpstream'
import type { ProbeFetch } from '@/main/servers/originPicks'
import type { UpdateFetch } from '@/main/updates'

type FetchBareProps = {
  url: string
  init: { headers: Record<string, string>; signal: AbortSignal }
}

/** No cookie rides along, a redirect fails rather than carry the request elsewhere, and nothing is cached. */
const BARE_REQUEST = { credentials: 'omit', redirect: 'error', cache: 'no-store' } as const

/** A bare request: the releases list, a media origin's probe and a ticketed download. */
const fetchBare = ({ url, init }: FetchBareProps) => net.fetch(url, { ...init, ...BARE_REQUEST })

export const fetchReleases: UpdateFetch = fetchBare

/** The relay's requests to a server: the ticket rides on the URL, never a cookie, and a redirect fails. */
export const fetchRelayed: UpstreamFetch = ({ url, method, headers, signal }) =>
  net.fetch(url, {
    method,
    headers,
    signal,
    ...BARE_REQUEST,
  })

/**
 * A media origin's probe, which `originPicks` times over the whole body. The timeout's signal
 * aborts the body's read too, so a probe that stalls mid-body fails at the timeout.
 */
export const fetchProbe: ProbeFetch = ({ url, timeoutMs }) =>
  fetchBare({ url, init: { headers: {}, signal: AbortSignal.timeout(timeoutMs) } })

/** A download's bytes: the ticket in the URL is the file's only key, so it sends no cookie. */
export const fetchDownload: StreamFetch = ({ url, headers, signal }) =>
  fetchBare({ url, init: { headers, signal } })

const ACCOUNT_READ_TIMEOUT_MS = 10_000
const ACCOUNT_READ_MAX_CHARS = 1_048_576

/**
 * Main's reads of the account's servers (`serverDirectory.ts`): the home server's account config,
 * the account's list, a server's health and its libraries. No cookie, no redirect, no cache, cut
 * off at ten seconds, and a body past a megabyte is refused rather than read whole.
 */
export const fetchAccountReads: FetchLike = async (url, init) => {
  const response = await net.fetch(url, {
    method: init?.method ?? HTTP_METHODS.get,
    headers: init?.headers ?? {},
    body: init?.body ?? null,
    ...BARE_REQUEST,
    signal: AbortSignal.timeout(ACCOUNT_READ_TIMEOUT_MS),
  })
  const text = await readCapped({
    body: response.body,
    maxChars: ACCOUNT_READ_MAX_CHARS,
    onOverflow: OVERFLOWS.refuse,
  })
  if (text === null) throw new RangeError('The server sent more than Raven reads')
  return {
    ok: response.ok,
    status: response.status,
    statusText: response.statusText,
    text: async () => text,
    json: async (): Promise<unknown> => JSON.parse(text),
  }
}
