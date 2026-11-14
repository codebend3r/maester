import { SAME_SITE, serializeCookie } from '@shared/server'
import { ROUTE_PREFIXES } from '@rookery/core'
import type { ServerConfig } from '@/config'
import { SESSION_MS } from '@/sessions/sessionsRepository'
import { PENDING_MS } from '@/auth/pendingSignIns'

/** The suite's session cookie, shared with every app under `COOKIE_DOMAIN`. */
export const SESSION_COOKIE = 'maester_session'
/** Ties a sign-in under way to the browser that started it; rookery's host only. */
export const PIN_COOKIE = 'rookery_pin'

/**
 * One of rookery's cookies: its name, the path it reaches, how long it lives,
 * and whether every app under `COOKIE_DOMAIN` sees it.
 */
type RookeryCookie = { name: string; path: string; maxAgeMs: number; isShared: boolean }

const SESSION = {
  name: SESSION_COOKIE,
  path: '/',
  maxAgeMs: SESSION_MS,
  isShared: true,
} as const satisfies RookeryCookie

/** The pin cookie only needs to reach the callback, which lives in this folder. */
const PIN = {
  name: PIN_COOKIE,
  path: `${ROUTE_PREFIXES.auth}plex`,
  maxAgeMs: PENDING_MS,
  isShared: false,
} as const satisfies RookeryCookie

type SerializeProps = {
  cookie: RookeryCookie
  value: string
  maxAgeSeconds: number
  config: ServerConfig
}

/** A clearing cookie keeps the `Domain` it was set with, or the browser keeps the old one. */
const serialize = ({ cookie, value, maxAgeSeconds, config }: SerializeProps): string =>
  serializeCookie({
    name: cookie.name,
    value,
    path: cookie.path,
    maxAgeSeconds,
    domain: cookie.isShared ? config.cookieDomain : null,
    sameSite: SAME_SITE.lax,
    isSecure: config.secureCookies,
  })

type WriteProps = { cookie: RookeryCookie; value: string; config: ServerConfig }

const write = ({ cookie, value, config }: WriteProps): string =>
  serialize({ cookie, value, maxAgeSeconds: Math.floor(cookie.maxAgeMs / 1000), config })

type ClearProps = { cookie: RookeryCookie; config: ServerConfig }

const clear = ({ cookie, config }: ClearProps): string =>
  serialize({ cookie, value: '', maxAgeSeconds: 0, config })

type SessionCookieProps = { token: string; config: ServerConfig }

export const sessionCookie = ({ token, config }: SessionCookieProps): string =>
  write({ cookie: SESSION, value: token, config })

type CookieConfigProps = { config: ServerConfig }

export const clearedSessionCookie = ({ config }: CookieConfigProps): string =>
  clear({ cookie: SESSION, config })

type PinCookieProps = { id: string; config: ServerConfig }

export const pinCookie = ({ id, config }: PinCookieProps): string =>
  write({ cookie: PIN, value: id, config })

export const clearedPinCookie = ({ config }: CookieConfigProps): string =>
  clear({ cookie: PIN, config })
