export const RESOURCE = 'resource'

export const CONTROLLER_CHANGE = 'controllerchange'

/** Where the build's hashed files live, which the worker keeps once it has fetched them. */
const ASSETS = '/assets/'

/** The part of the page's `ServiceWorkerContainer` this reads. */
type Workers = {
  ready: Promise<unknown>
  controller: unknown
  addEventListener: (type: string, listener: () => void, options: AddEventListenerOptions) => void
}

type KeepOfflinePagesProps = {
  target: {
    navigator: { serviceWorker?: Workers }
    performance: Pick<Performance, 'getEntriesByType'>
    location: Pick<Location, 'origin'>
    fetch: (url: string) => Promise<unknown>
  }
  /** The chunks of the pages shown with no server, which a visit may never have asked for. */
  pages: ReadonlyArray<() => Promise<unknown>>
}

/** Settles once the worker answers this page's requests, which it starts doing a moment after it is ready. */
const controlled = async (workers: Workers): Promise<void> => {
  await workers.ready
  if (workers.controller !== null) return
  await new Promise<void>((resolve) => {
    workers.addEventListener(CONTROLLER_CHANGE, () => resolve(), { once: true })
  })
}

/**
 * Has the service worker keep what the app needs to open with no network. The worker keeps a
 * build file only when it sees it fetched, and it sees nothing of the visit that installed it,
 * nor a page nobody has opened yet. So once it answers for the page, every build file the page
 * has loaded is fetched again through it (from the HTTP cache, so nothing is downloaded twice),
 * and the chunks of the pages a server out of reach leaves are asked for. In a browser with no
 * worker, or a dev server that registers none, it waits for one for ever and does nothing.
 */
export const keepOfflinePages = async ({ target, pages }: KeepOfflinePagesProps): Promise<void> => {
  const workers = target.navigator.serviceWorker
  if (workers === undefined) return
  await controlled(workers)
  const prefix = `${target.location.origin}${ASSETS}`
  const loaded = target.performance
    .getEntriesByType(RESOURCE)
    .map(({ name }) => name)
    .filter((name) => name.startsWith(prefix))
  await Promise.all([...new Set(loaded)].map((url) => target.fetch(url).catch(() => undefined)))
  await Promise.all(pages.map((load) => load().catch(() => undefined)))
}
