import { DEFAULT_SERVER_ORIGIN } from '@raven/core'
import { CACHE_POLICIES, CONTENT_TYPES, HEADERS } from '@shared/http'

/** Netlify's own headers, beside the shared `HEADERS`. */
const NETLIFY_HEADERS = {
  cacheId: 'netlify-cache-id',
  cdnCacheControl: 'netlify-cdn-cache-control',
} as const

/** Kept by every Netlify edge node through the shared durable cache. */
const DURABLE_POLICY = 'public, durable, max-age=31536000, immutable'

/** Opts the pictures out of the purge every deploy runs, since an address never changes what it names. */
const CACHE_ID = 'raven-pictures'

type UpstreamInit = { method: string }

/** The one call the function makes to raven; `fetch` is one. */
type FetchUpstream = (url: URL, init: UpstreamInit) => Promise<Response>

type ProxyPictureProps = {
  request: Request
  /** raven's public origin, the one `netlify.toml` proxies /api to. */
  origin: string
  fetchUpstream: FetchUpstream
}

/**
 * One of raven's capability pictures, fetched from raven. The `/api` proxy in
 * `netlify.toml` is cached by each edge node on its own and emptied by every
 * deploy, so a picture went back to raven, through the NAS's upload, on most
 * requests. A function's `durable` response is shared by every node instead.
 * The address names the picture's version, so a kept copy never goes stale,
 * and anyone may keep it (`PicturesController`). A refusal is passed on uncached.
 */
export const proxyPicture = async ({
  request,
  origin,
  fetchUpstream,
}: ProxyPictureProps): Promise<Response> => {
  // The path alone: no query string reaches raven or splits the cache.
  const { pathname } = new URL(request.url)
  const upstream = await fetchUpstream(new URL(pathname, origin), { method: request.method })
  if (!upstream.ok) {
    return new Response(upstream.body, {
      status: upstream.status,
      headers: {
        [HEADERS.cacheControl]: CACHE_POLICIES.noStore,
        [NETLIFY_HEADERS.cdnCacheControl]: CACHE_POLICIES.noStore,
      },
    })
  }
  return new Response(upstream.body, {
    headers: {
      [HEADERS.contentType]: upstream.headers.get(HEADERS.contentType) ?? CONTENT_TYPES.octetStream,
      [HEADERS.cacheControl]: CACHE_POLICIES.immutable,
      [NETLIFY_HEADERS.cdnCacheControl]: DURABLE_POLICY,
      [NETLIFY_HEADERS.cacheId]: CACHE_ID,
    },
  })
}

// Netlify runs a function through its default export and routes by `config`.
export default (request: Request): Promise<Response> =>
  proxyPicture({ request, origin: DEFAULT_SERVER_ORIGIN, fetchUpstream: fetch })

/** Ahead of the `/api/*` proxy in `netlify.toml`, which still carries every other call. */
export const config = { path: '/api/pictures/*', method: ['GET', 'HEAD'] }
