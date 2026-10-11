import type { ServerConfig } from '@/config.js'
import { SESSION_MS } from '@/sessions/sessionsRepository.js'
import { PENDING_MS } from '@/auth/pendingSignIns.js'

/** The suite's session cookie, shared with every app under `COOKIE_DOMAIN`. */
export const SESSION_COOKIE = 'maester_session'
/** Ties a sign-in under way to the browser that started it; rookery's host only. */
export const PIN_COOKIE = 'rookery_pin'
/** The pin cookie only needs to reach the callback. */
const PIN_PATH = '/auth/plex'

/** The value of cookie `name` in a `Cookie` header, or null. */
export const readCookie = ({
  header,
  name,
}: {
  header: string | undefined
  name: string
}): string | null => {
  const found = (header ?? '')
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`))
  const value = found?.slice(name.length + 1) ?? ''
  return value === '' ? null : value
}

const serialize = ({
  name,
  value,
  path,
  maxAgeSeconds,
  domain,
  secure,
}: {
  name: string
  value: string
  path: string
  maxAgeSeconds: number
  domain: string | null
  secure: boolean
}): string =>
  [
    `${name}=${value}`,
    `Path=${path}`,
    `Max-Age=${maxAgeSeconds}`,
    ...(domain ? [`Domain=${domain}`] : []),
    'HttpOnly',
    'SameSite=Lax',
    ...(secure ? ['Secure'] : []),
  ].join('; ')

const seconds = (ms: number): number => Math.floor(ms / 1000)

export const sessionCookie = ({ token, config }: { token: string; config: ServerConfig }) =>
  serialize({
    name: SESSION_COOKIE,
    value: token,
    path: '/',
    maxAgeSeconds: seconds(SESSION_MS),
    domain: config.cookieDomain,
    secure: config.secureCookies,
  })

/** Clears the session cookie; the `Domain` must match the one it was set with. */
export const clearedSessionCookie = ({ config }: { config: ServerConfig }) =>
  serialize({
    name: SESSION_COOKIE,
    value: '',
    path: '/',
    maxAgeSeconds: 0,
    domain: config.cookieDomain,
    secure: config.secureCookies,
  })

export const pinCookie = ({ id, config }: { id: string; config: ServerConfig }) =>
  serialize({
    name: PIN_COOKIE,
    value: id,
    path: PIN_PATH,
    maxAgeSeconds: seconds(PENDING_MS),
    domain: null,
    secure: config.secureCookies,
  })

export const clearedPinCookie = ({ config }: { config: ServerConfig }) =>
  serialize({
    name: PIN_COOKIE,
    value: '',
    path: PIN_PATH,
    maxAgeSeconds: 0,
    domain: null,
    secure: config.secureCookies,
  })
