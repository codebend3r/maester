/** Where raven is: the site's environment variable, scoped to builds and functions. */
const ENV = { apiOrigin: 'RAVEN_API_ORIGIN' } as const

const HEADERS = {
  cacheControl: 'cache-control',
  contentType: 'content-type',
  netlifyCacheId: 'netlify-cache-id',
  netlifyCdnCacheControl: 'netlify-cdn-cache-control',
} as const

const CACHE_POLICIES = {
  /** Kept by the browser for good, raven's own policy for a capability picture. */
  browser: 'public, max-age=31536000, immutable',
  /** Kept by every Netlify edge node through the shared durable cache. */
  durable: 'public, durable, max-age=31536000, immutable',
  none: 'no-store',
} as const

/** Opts the pictures out of the purge every deploy runs, since an address never changes what it names. */
const CACHE_ID = 'raven-pictures'

const FALLBACK_TYPE = 'application/octet-stream'

type UpstreamInit = { method: string }

/** The one call the function makes to raven; `fetch` is one. */
type FetchUpstream = (url: URL, init: UpstreamInit) => Promise<Response>

type ProxyPictureProps = {
  request: Request
  /** raven's origin, or undefined when the site does not give functions one. */
  origin: string | undefined
  fetchUpstream: FetchUpstream
}

/**
 * One of raven's capability pictures, fetched from raven. The `/api` proxy in
 * `_redirects` is cached by each edge node on its own and emptied by every
 * deploy, so a picture went back to raven, through its Funnel, on most
 * requests. A function's `durable` response is shared by every node instead.
 * The address names the picture's version, so a kept copy never goes stale,
 * and anyone may keep it (`PicturesController`). A refusal is passed on uncached.
 */
export const proxyPicture = async ({
  request,
  origin,
  fetchUpstream,
}: ProxyPictureProps): Promise<Response> => {
  if (!origin) {
    console.error(`${ENV.apiOrigin} is not set for functions`)
    return new Response(null, { status: 502 })
  }
  // The path alone: no query string reaches raven or splits the cache.
  const { pathname } = new URL(request.url)
  const upstream = await fetchUpstream(new URL(pathname, origin), { method: request.method })
  if (!upstream.ok) {
    return new Response(upstream.body, {
      status: upstream.status,
      headers: {
        [HEADERS.cacheControl]: CACHE_POLICIES.none,
        [HEADERS.netlifyCdnCacheControl]: CACHE_POLICIES.none,
      },
    })
  }
  return new Response(upstream.body, {
    headers: {
      [HEADERS.contentType]: upstream.headers.get(HEADERS.contentType) ?? FALLBACK_TYPE,
      [HEADERS.cacheControl]: CACHE_POLICIES.browser,
      [HEADERS.netlifyCdnCacheControl]: CACHE_POLICIES.durable,
      [HEADERS.netlifyCacheId]: CACHE_ID,
    },
  })
}

// Netlify runs a function through its default export and routes by `config`.
export default (request: Request): Promise<Response> =>
  proxyPicture({ request, origin: process.env[ENV.apiOrigin], fetchUpstream: fetch })

/** Ahead of the `/api/*` proxy in `_redirects`, which still carries every other call. */
export const config = { path: '/api/pictures/*', method: ['GET', 'HEAD'] }
