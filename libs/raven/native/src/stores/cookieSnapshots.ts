import { SERVER_COOKIES } from '@raven/core'
import { create } from 'zustand'

import type { KnownCookies, ServerCookies } from '@/servers/cookieJar'

type CookieSnapshots = {
  /** What the jar last held for each server, by server id; missing until the jar first answers. */
  byServer: Readonly<Record<string, ServerCookies>>
}

/**
 * The jar's last word on each server's cookies, for every reader outside `fetch`: the pictures'
 * headers, the screens that show a locked library's downloads, and the music host, which asks
 * as each track plays. The jar writes it as it reads or changes a server's cookies.
 */
export const useCookieSnapshots = create<CookieSnapshots>()(() => ({ byServer: {} }))

export const noteCookies = ({ serverId, cookies }: KnownCookies): void =>
  useCookieSnapshots.setState((state) => ({ byServer: { ...state.byServer, [serverId]: cookies } }))

/** Whether these cookies hold the server's PIN unlock, which shows a locked library's downloads. */
export const isUnlockedBy = (cookies: ServerCookies | null): boolean =>
  (cookies?.[SERVER_COOKIES.unlock] ?? '') !== ''

/** Whether this device holds `serverId`'s PIN unlock, as last read; false until the jar answers. */
export const unlockNow = (serverId: string): boolean =>
  isUnlockedBy(useCookieSnapshots.getState().byServer[serverId] ?? null)
