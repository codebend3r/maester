import { SERVICE_WORKER } from '@raven/core'

const PAGE_EVENTS = { load: 'load' } as const

const READY_STATES = { complete: 'complete' } as const

/** The part of the browser's `ServiceWorkerContainer` the page uses. */
type WorkerContainer = {
  register: (path: string, options: RegistrationOptions) => Promise<unknown>
}

/** The part of `window` the start reads: its workers, whether it has loaded, its load event. */
type WorkerPage = {
  navigator: { serviceWorker?: WorkerContainer }
  document: { readyState: DocumentReadyState }
  addEventListener: (type: string, listener: () => void, options: AddEventListenerOptions) => void
}

type StartServiceWorkerProps = {
  target: WorkerPage
  /** Only a build has `/sw.js`; the dev server serves no worker. */
  isProduction: boolean
  /** Raven serves the page itself from its loopback host and keeps its own offline shell. */
  isDesktop: boolean
}

/**
 * Registers the service worker that makes the app installable and opens it offline, once the
 * page has loaded, so it never competes with the first paint. A worker that fails to register
 * leaves the app as it was, a page the network serves.
 */
export const startServiceWorker = ({
  target,
  isProduction,
  isDesktop,
}: StartServiceWorkerProps) => {
  // An insecure origin has no `serviceWorker`, whatever the DOM's types say.
  const container = target.navigator.serviceWorker
  if (!container || !isProduction || isDesktop) return
  const register = () => {
    container.register(SERVICE_WORKER.path, { scope: SERVICE_WORKER.scope }).catch(() => undefined)
  }
  if (target.document.readyState === READY_STATES.complete) {
    register()
    return
  }
  target.addEventListener(PAGE_EVENTS.load, register, { once: true })
}
