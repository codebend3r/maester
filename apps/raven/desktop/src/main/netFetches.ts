import { net } from 'electron'
import type { StreamFetch } from '@/main/downloads/fetchFile'
import type { ProbeFetch } from '@/main/downloads/mediaAccess'
import type { UpstreamFetch } from '@/main/servers/mediaRelay'
import type { UpdateFetch } from '@/main/updates'

type FetchBareProps = {
  url: string
  init: { headers: Record<string, string>; signal: AbortSignal }
}

// No cookie rides along, a redirect fails rather than carry the request elsewhere, and
// nothing is cached: the releases list, a media origin's probe and a ticketed download.
const fetchBare = ({ url, init }: FetchBareProps) =>
  net.fetch(url, { ...init, credentials: 'omit', redirect: 'error', cache: 'no-store' })

export const fetchReleases: UpdateFetch = fetchBare

/** The relay's requests to a server: the ticket rides on the URL, never a cookie, and a redirect fails. */
export const fetchRelayed: UpstreamFetch = ({ url, method, headers, signal }) =>
  net.fetch(url, {
    method,
    headers,
    signal,
    credentials: 'omit',
    redirect: 'error',
    cache: 'no-store',
  })

/**
 * A media origin's probe, which `mediaAccess` times over the whole body. The timeout's signal
 * aborts the body's read too, so a probe that stalls mid-body fails at the timeout.
 */
export const fetchProbe: ProbeFetch = ({ url, timeoutMs }) =>
  fetchBare({ url, init: { headers: {}, signal: AbortSignal.timeout(timeoutMs) } })

/** A download's bytes: the ticket in the URL is the file's only key, so it sends no cookie. */
export const fetchDownload: StreamFetch = ({ url, headers, signal }) =>
  fetchBare({ url, init: { headers, signal } })
