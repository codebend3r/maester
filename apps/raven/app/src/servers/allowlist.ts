import {
  APP_CALL_METHODS,
  APP_CLIENT_CALLS,
  type AppClientCall,
  type AppClientCallName,
  type FetchLike,
  appClientCallOf,
} from '@raven/core'

/**
 * The admin lock's calls, for a server without accounts alone: on a server with them only the
 * owner manages, and the app never asks it for the admin password.
 */
const ADMIN_LOCK_CALLS: ReadonlySet<AppClientCall> = new Set([
  APP_CLIENT_CALLS.getAdminLock,
  APP_CLIENT_CALLS.unlockAdmin,
])

/** The address without its query or fragment, which may hold a ticket. */
const withoutQuery = (url: string): string => url.replace(/[?#].*$/su, '')

/**
 * The name of the call `method` and `url` are among core's `APP_CLIENT_CALLS`; it throws for
 * any other, so no screen can reach an `@AdminOnly()` route or a write the app has no business
 * with. What it throws names the method and the address without its query, which may hold a
 * ticket.
 */
export const checkAppCall = ({
  method,
  url,
}: {
  method: string
  url: string
}): AppClientCallName => {
  const name = appClientCallOf({ method, url })
  if (name !== null) return name
  throw new Error(`raven's app does not call ${method} ${withoutQuery(url)}`)
}

/**
 * `fetch` that sends only the app's calls and throws on any other, before the server hears of
 * it, and on the admin lock's calls whenever `hasAccounts` says, at that call, that the server
 * signs in with accounts.
 */
export const allowlistedFetch =
  ({ fetch, hasAccounts }: { fetch: FetchLike; hasAccounts: () => boolean }): FetchLike =>
  async (url, init = {}) => {
    const method = init.method ?? APP_CALL_METHODS.get
    const name = checkAppCall({ method, url })
    if (ADMIN_LOCK_CALLS.has(APP_CLIENT_CALLS[name]) && hasAccounts()) {
      throw new Error(
        `raven's app does not call ${method} ${withoutQuery(url)} on a server with accounts`,
      )
    }
    return fetch(url, init)
  }
