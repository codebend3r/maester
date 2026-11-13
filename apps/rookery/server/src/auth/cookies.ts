import { SAME_SITE, serializeCookie } from '@shared/server'
import { ROUTE_PREFIXES } from '@rookery/core'
import type { ServerConfig } from '@/config'
import { SESSION_MS } from '@/sessions/sessionsRepository'
import { PENDING_MS } from '@/auth/pendingSignIns'

/** The suite's session cookie, shared with every app under `COOKIE_DOMAIN`. */
export const SESSION_COOKIE = 'maester_session'
/** Ties a sign-in under way to the browser that started it; rookery's host only. */
export const PIN_COOKIE = 'rookery_pin'
/** The pin cookie only needs to reach the callback, which lives in this folder. */
const PIN_PATH = `${ROUTE_PREFIXES.auth}plex`
const SESSION_PATH = '/'

const seconds = (ms: number): number => Math.floor(ms / 1000)

type SessionCookieProps = { token: string; config: ServerConfig }

export const sessionCookie = ({ token, config }: SessionCookieProps): string =>
  serializeCookie({
    name: SESSION_COOKIE,
    value: token,
    path: SESSION_PATH,
    maxAgeSeconds: seconds(SESSION_MS),
    domain: config.cookieDomain,
    sameSite: SAME_SITE.lax,
    isSecure: config.secureCookies,
  })

type CookieConfigProps = { config: ServerConfig }

/** Clears the session cookie; the `Domain` must match the one it was set with. */
export const clearedSessionCookie = ({ config }: CookieConfigProps): string =>
  serializeCookie({
    name: SESSION_COOKIE,
    value: '',
    path: SESSION_PATH,
    maxAgeSeconds: 0,
    domain: config.cookieDomain,
    sameSite: SAME_SITE.lax,
    isSecure: config.secureCookies,
  })

type PinCookieProps = { id: string; config: ServerConfig }

export const pinCookie = ({ id, config }: PinCookieProps): string =>
  serializeCookie({
    name: PIN_COOKIE,
    value: id,
    path: PIN_PATH,
    maxAgeSeconds: seconds(PENDING_MS),
    domain: null,
    sameSite: SAME_SITE.lax,
    isSecure: config.secureCookies,
  })

export const clearedPinCookie = ({ config }: CookieConfigProps): string =>
  serializeCookie({
    name: PIN_COOKIE,
    value: '',
    path: PIN_PATH,
    maxAgeSeconds: 0,
    domain: null,
    sameSite: SAME_SITE.lax,
    isSecure: config.secureCookies,
  })
