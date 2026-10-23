import { APP_CALL_METHODS, type FetchLike, appClientCallOf } from '@raven/core'

/**
 * Throws unless `method` and `url` are one of core's `APP_CLIENT_CALLS`, so no screen can
 * reach an `@AdminOnly()` route or a write the app has no business with. What it throws
 * names the method and the address without its query, which may hold a ticket.
 */
export const checkAppCall = ({ method, url }: { method: string; url: string }): void => {
  if (appClientCallOf({ method, url }) !== null) return
  throw new Error(`raven's app does not call ${method} ${url.replace(/[?#].*$/su, '')}`)
}

/** `fetch` that sends only the app's calls and throws on any other, before the server hears of it. */
export const allowlistedFetch =
  ({ fetch }: { fetch: FetchLike }): FetchLike =>
  async (url, init = {}) => {
    checkAppCall({ method: init.method ?? APP_CALL_METHODS.get, url })
    return fetch(url, init)
  }
