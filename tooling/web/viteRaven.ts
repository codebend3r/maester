import { URL_PROTOCOLS } from '@raven/core'
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
export const NETLIFY_IMAGE_CDN = '/.netlify/images'

/** Whether this is a Netlify build, which `netlify.toml` serves with /api proxied to raven. */
export const IS_NETLIFY = process.env[RAVEN_ENV.netlify] === NETLIFY_VALUES.on

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
export const devApiOrigin = ({ mode, ravenDir, example }: DevApiOriginProps): string => {
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

/** A chunk of its own, and the packages that go in it. */
type VendorChunk = { name: string; packages: readonly string[] }

/** rolldown's code splitting groups for an app's `VENDOR_CHUNKS`, one chunk each. */
export const vendorChunkGroups = (chunks: readonly VendorChunk[]) =>
  chunks.map(({ name, packages }) => ({
    name,
    test: vendorChunkTest(packages),
    priority: VENDOR_PRIORITY,
  }))
