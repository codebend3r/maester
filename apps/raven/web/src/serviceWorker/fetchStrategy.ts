/**
 * How the service worker answers each request. It keeps only the app's own shell and static
 * files: never `/api` (an account's data, tickets, pictures, streams), never a ranged request
 * (video and audio), never another origin (the media origins, Supabase) and never a write.
 */
export const FETCH_STRATEGIES = {
  network: 'network',
  shell: 'shell',
  asset: 'asset',
  file: 'file',
} as const

export type FetchStrategy = (typeof FETCH_STRATEGIES)[keyof typeof FETCH_STRATEGIES]

/** The caches the worker writes; a name that is not here is an older worker's and is removed. */
export const CACHE_NAMES = {
  shell: 'raven-shell-v1',
  assets: 'raven-assets-v1',
  files: 'raven-files-v1',
} as const

/** The page every navigation falls back to offline: the single-page app's index. */
export const SHELL_PATH = '/'

/**
 * How many hashed build files the worker keeps. Each release names new ones, so the oldest are
 * dropped past this rather than piling up release after release.
 */
export const ASSET_CACHE_LIMIT = 300

const NETWORK_ONLY_PREFIXES = ['/api/', '/.netlify/'] as const

const ASSET_PREFIX = '/assets/'

/** The static files beside the build kept for offline: icons, the manifest, fonts. */
const STATIC_FILE = /\.(?:png|svg|ico|webmanifest|woff2|txt)$/

const METHODS = { get: 'GET' } as const

const REQUEST_MODES = { navigate: 'navigate' } as const

/** What the worker reads off a request to choose how to answer it. */
export type RequestFacts = {
  method: string
  url: string
  mode: string
  hasRange: boolean
}

type StrategyForProps = {
  request: RequestFacts
  /** The worker's own origin, which the app is served from. */
  origin: string
}

/**
 * A navigation goes to the network first and falls back to the cached shell, a hashed build
 * file is served from the cache once fetched, a static file is served from the cache while it
 * is fetched again, and everything else is left to the network untouched.
 */
export const strategyFor = ({ request, origin }: StrategyForProps): FetchStrategy => {
  if (request.method !== METHODS.get || request.hasRange) return FETCH_STRATEGIES.network
  const url = new URL(request.url)
  if (url.origin !== origin) return FETCH_STRATEGIES.network
  if (NETWORK_ONLY_PREFIXES.some((prefix) => url.pathname.startsWith(prefix))) {
    return FETCH_STRATEGIES.network
  }
  if (request.mode === REQUEST_MODES.navigate) return FETCH_STRATEGIES.shell
  if (url.pathname.startsWith(ASSET_PREFIX)) return FETCH_STRATEGIES.asset
  return STATIC_FILE.test(url.pathname) ? FETCH_STRATEGIES.file : FETCH_STRATEGIES.network
}

type OverflowOfProps<T> = {
  /** The cache's keys in the order they were stored, oldest first. */
  keys: readonly T[]
  limit: number
}

/** The cached copies past `limit`, oldest first, which the worker deletes. */
export const overflowOf = <T>({ keys, limit }: OverflowOfProps<T>): T[] =>
  keys.slice(0, Math.max(0, keys.length - limit))

const HTML_TYPE = 'text/html'

type IsShellAnswerProps = {
  status: number
  isRedirected: boolean
  contentType: string | null
}

/** Whether a navigation's answer is the app's own page, the one worth keeping as the shell. */
export const isShellAnswer = ({ status, isRedirected, contentType }: IsShellAnswerProps) =>
  status === 200 && !isRedirected && (contentType ?? '').startsWith(HTML_TYPE)
