import { DEFAULT_SERVER_ORIGIN, URL_PROTOCOLS } from '@raven/core'
import { loadEnv } from 'vite'

// What the Vite configs of raven's web app and Wren's share.

/** The environment variables both builds and their dev servers read. */
const RAVEN_ENV = {
  devApiOrigin: 'RAVEN_DEV_API_ORIGIN',
  netlify: 'NETLIFY',
} as const

/** Where the dev server proxies /api without RAVEN_DEV_API_ORIGIN: the local server (`nx run @raven/server:dev`). */
const LOCAL_API_ORIGIN = 'http://localhost:8484'

/** What Netlify sets `NETLIFY` to in its builds. */
const NETLIFY_VALUES = { on: 'true' } as const

/**
 * Netlify's Image CDN on the site's own origin. It fetches a relative picture through the site's
 * `/api` proxy, with no cookie or token, so only raven's capability pictures (`/api/pictures`) go
 * through it.
 */
const NETLIFY_IMAGE_CDN = '/.netlify/images'

/** Whether this is a Netlify build, which `netlify.toml` serves with /api proxied to raven. */
const IS_NETLIFY = process.env[RAVEN_ENV.netlify] === NETLIFY_VALUES.on

/**
 * What both builds fill in for the page: where pictures go through Netlify's Image CDN, and
 * raven's own origin on Netlify, where `netlify.toml` proxies /api, signed, to it, so music plays
 * from raven itself and never through the proxy. Both are '' when /api is raven itself.
 * core's `DEFAULT_SERVER_ORIGIN` is that origin, and each app's `netlifyToml.test.ts` fails when
 * its proxy names any other.
 */
export const NETLIFY_DEFINES = {
  'import.meta.env.VITE_PICTURE_CDN': JSON.stringify(IS_NETLIFY ? NETLIFY_IMAGE_CDN : ''),
  'import.meta.env.VITE_API_ORIGIN': JSON.stringify(IS_NETLIFY ? DEFAULT_SERVER_ORIGIN : ''),
} as const

const WEB_PROTOCOLS = new Set<string>([URL_PROTOCOLS.http, URL_PROTOCOLS.https])

type DevApiOriginProps = {
  /** Vite's mode, which picks the `.env` files read. */
  mode: string
  /** raven's own folder, whose `.env` (beside the compose file) names the origin when the shell does not. */
  ravenDir: string
  /** An origin the app's developers point it at, which the error offers as the shape to write. */
  example: string
}

/**
 * The raven the dev server proxies /api to: RAVEN_DEV_API_ORIGIN from the shell, else from
 * raven's `.env`, else the local server. An http or https origin with no path.
 */
const devApiOrigin = ({ mode, ravenDir, example }: DevApiOriginProps): string => {
  const origin =
    process.env[RAVEN_ENV.devApiOrigin] ?? loadEnv(mode, ravenDir, '')[RAVEN_ENV.devApiOrigin] ?? ''
  if (!origin) return LOCAL_API_ORIGIN
  const url = URL.canParse(origin) ? new URL(origin) : null
  if (!url || !WEB_PROTOCOLS.has(url.protocol) || url.origin !== origin.replace(/\/+$/, '')) {
    throw new Error(
      `RAVEN_DEV_API_ORIGIN must be an http or https origin with no path, such as ${example}, not ${origin}`,
    )
  }
  return url.origin
}

/** Above rolldown's own chunking, which decides what is left. */
const VENDOR_PRIORITY = 10

/** A module's id with `/` between folders, whatever the build machine writes. */
const posixId = (id: string) => id.replaceAll('\\', '/')

const vendorChunkTest = (packages: readonly string[]) => (id: string) =>
  packages.some((name) => posixId(id).includes(`/node_modules/${name}/`))

/** The paths the dev server hands to raven. */
const PROXIED_PATHS = { api: '/api' } as const

/**
 * The dev server's /api proxy to the raven `devApiOrigin` names. raven runs on its own port in
 * development, or on another machine, so the browser sees one origin and the session's cookie
 * opens every cover and track; the Host header follows the target, as a raven behind a name
 * expects.
 */
export const apiProxy = (props: DevApiOriginProps) =>
  ({ [PROXIED_PATHS.api]: { target: devApiOrigin(props), changeOrigin: true } }) as const

/**
 * The dependencies that change on their own schedule, each in a chunk of its own, so a release
 * leaves their cached chunks as they were and no chunk nears Vite's 500 kB warning. Everything
 * else, raven's own libraries included, is rolldown's to split.
 */
const VENDOR_CHUNKS = [
  { name: 'react', packages: ['react', 'react-dom', 'scheduler'] },
  { name: 'router', packages: ['react-router', 'react-router-dom'] },
  { name: 'query', packages: ['@tanstack/react-query', '@tanstack/query-core'] },
  { name: 'supabase', packages: ['@supabase'] },
] as const

/** rolldown's code splitting groups for the vendor chunks, one chunk each. */
export const VENDOR_GROUPS = VENDOR_CHUNKS.map(({ name, packages }) => ({
  name,
  test: vendorChunkTest(packages),
  priority: VENDOR_PRIORITY,
}))
