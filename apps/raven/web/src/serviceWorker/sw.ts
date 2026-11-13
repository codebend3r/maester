import {
  ASSET_CACHE_LIMIT,
  CACHE_NAMES,
  FETCH_STRATEGIES,
  type FetchStrategy,
  SHELL_PATH,
  isShellAnswer,
  overflowOf,
  strategyFor,
} from '@/serviceWorker/fetchStrategy'

/*
 * The installed app's service worker, built on its own to `/sw.js` (vite.config.ts). It opens
 * the app instantly and offline from its cached shell and build files, and leaves the account's
 * data and every stream to the network: see `strategyFor`. Typed against the WebWorker library
 * by `tsconfig.worker.json`, so it imports nothing that needs the DOM.
 */
declare const self: ServiceWorkerGlobalScope

const KEPT_CACHES: readonly string[] = Object.values(CACHE_NAMES)

const WORKER_EVENTS = { install: 'install', activate: 'activate', fetch: 'fetch' } as const

const HTTP_CACHE_MODES = { reload: 'reload' } as const

// Past the HTTP cache, so the kept shell is the server's current page.
const SHELL_REQUEST: RequestInit = { cache: HTTP_CACHE_MODES.reload }

/*
 * Its own copy of @shared/http's two names: the page imports that module too, so the build would
 * split it into a chunk the worker imports, and a classic worker script cannot import.
 */
const HEADERS = { contentType: 'content-type', range: 'range' } as const

/** Keeps the app's index for offline; a failure leaves it for the next navigation to store. */
const storeShell = async (): Promise<void> => {
  const cache = await caches.open(CACHE_NAMES.shell)
  await cache.add(new Request(SHELL_PATH, SHELL_REQUEST)).catch(() => undefined)
}

const dropOldCaches = async (): Promise<void> => {
  const names = await caches.keys()
  await Promise.all(
    names.filter((name) => !KEPT_CACHES.includes(name)).map((name) => caches.delete(name)),
  )
}

type KeepAssetProps = { cache: Cache; request: Request; answer: Response }

const trimAssets = async (cache: Cache): Promise<void> => {
  const keys = await cache.keys()
  await Promise.all(overflowOf({ keys, limit: ASSET_CACHE_LIMIT }).map((key) => cache.delete(key)))
}

const keepShell = async (answer: Response): Promise<void> => {
  const cache = await caches.open(CACHE_NAMES.shell)
  await cache.put(SHELL_PATH, answer)
}

/** The network's page, kept as the shell when it is the app's own; offline, the kept shell. */
const answerNavigation = async (event: FetchEvent): Promise<Response> => {
  const answer = await fetch(event.request).catch(() => null)
  if (!answer) {
    const shell = await caches.match(SHELL_PATH, { cacheName: CACHE_NAMES.shell })
    return shell ?? Response.error()
  }
  const isShell = isShellAnswer({
    status: answer.status,
    isRedirected: answer.redirected,
    contentType: answer.headers.get(HEADERS.contentType),
  })
  if (isShell) event.waitUntil(keepShell(answer.clone()))
  return answer
}

const keepAsset = async ({ cache, request, answer }: KeepAssetProps): Promise<void> => {
  await cache.put(request, answer)
  await trimAssets(cache)
}

/** A hashed build file never changes, so a kept copy is always right. */
const answerAsset = async (event: FetchEvent): Promise<Response> => {
  const cache = await caches.open(CACHE_NAMES.assets)
  const kept = await cache.match(event.request)
  if (kept) return kept
  const answer = await fetch(event.request).catch(() => null)
  if (!answer) return Response.error()
  if (answer.ok)
    event.waitUntil(keepAsset({ cache, request: event.request, answer: answer.clone() }))
  return answer
}

/** The kept copy at once, fetched again behind it; the network's when nothing is kept. */
const answerFile = async (event: FetchEvent): Promise<Response> => {
  const cache = await caches.open(CACHE_NAMES.files)
  const kept = await cache.match(event.request)
  const refresh = fetch(event.request)
    .then(async (answer) => {
      if (answer.ok) await cache.put(event.request, answer.clone())
      return answer
    })
    .catch(() => null)
  event.waitUntil(refresh)
  return kept ?? (await refresh) ?? Response.error()
}

type Answer = (event: FetchEvent) => void

const ANSWERS = {
  // Not answering hands the request to the browser as if no worker were there.
  [FETCH_STRATEGIES.network]: () => undefined,
  [FETCH_STRATEGIES.shell]: (event) => event.respondWith(answerNavigation(event)),
  [FETCH_STRATEGIES.asset]: (event) => event.respondWith(answerAsset(event)),
  [FETCH_STRATEGIES.file]: (event) => event.respondWith(answerFile(event)),
} as const satisfies Record<FetchStrategy, Answer>

self.addEventListener(WORKER_EVENTS.install, (event) => {
  event.waitUntil(storeShell().then(() => self.skipWaiting()))
})

self.addEventListener(WORKER_EVENTS.activate, (event) => {
  event.waitUntil(dropOldCaches().then(() => self.clients.claim()))
})

self.addEventListener(WORKER_EVENTS.fetch, (event) => {
  const { request } = event
  const strategy = strategyFor({
    request: {
      method: request.method,
      url: request.url,
      mode: request.mode,
      hasRange: request.headers.has(HEADERS.range),
    },
    origin: self.location.origin,
  })
  ANSWERS[strategy](event)
})
