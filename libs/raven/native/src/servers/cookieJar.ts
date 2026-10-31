import { SERVER_COOKIES, isRecord, isString, oneOf } from '@raven/core'

import { type SecretStore, settle } from '@/servers/secretStore'

type ServerCookieName = (typeof SERVER_COOKIES)[keyof typeof SERVER_COOKIES]

/** A server's cookies by name: the PIN's unlock and the admin lock's. */
export type ServerCookies = Partial<Record<ServerCookieName, string>>

export const COOKIE_CHANGES = { set: 'set', cleared: 'cleared' } as const

type CookieChange =
  | { kind: typeof COOKIE_CHANGES.set; value: string }
  | { kind: typeof COOKIE_CHANGES.cleared }

/** What a response's `set-cookie` does to each cookie it names; one it leaves out is unchanged. */
export type CookieChanges = Partial<Record<ServerCookieName, CookieChange>>

type ApplyProps = { serverId: string; changes: CookieChanges }

/** Each server's cookies, held by the app and never by the system's shared jar. */
export type CookieJar = {
  read: (serverId: string) => Promise<ServerCookies>
  apply: (args: ApplyProps) => Promise<void>
  forget: (serverId: string) => Promise<void>
}

const COOKIE_KEY_PREFIX = 'raven.cookie.'
const COOKIE_NAMES = Object.values(SERVER_COOKIES)
const isServerCookieName = oneOf(COOKIE_NAMES)
const COOKIE_ATTRIBUTES = { maxAge: 'max-age' } as const

// The server signs each value in base64url with `.` between the parts; anything wider,
// a `,`, `;`, space or line break above all, would split the header or add one.
const COOKIE_VALUE = /^[A-Za-z0-9._~-]+$/u

// iOS and Android hand several `Set-Cookie` headers over as one, joined with commas, so a
// cookie starts the header or follows a comma before a `name=`. An `Expires` date's comma
// is followed by the day of the month, never by a name and an `=`.
const COOKIE_START = /,(?=\s*[\w!#$%&'*+.^`|~-]+=)/u

export const cookieKeyFor = (serverId: string): string => `${COOKIE_KEY_PREFIX}${serverId}`

const changeOf = (cookie: string): [ServerCookieName, CookieChange] | null => {
  const [pair = '', ...attributes] = cookie.split(';')
  const equals = pair.indexOf('=')
  const name = pair.slice(0, equals).trim()
  const value = pair.slice(equals + 1).trim()
  if (equals === -1 || !isServerCookieName(name)) return null
  const maxAge =
    attributes
      .map((attribute) => attribute.split('='))
      .find(([key = '']) => key.trim().toLowerCase() === COOKIE_ATTRIBUTES.maxAge)?.[1] ?? null
  // The server clears a cookie with an empty value and `Max-Age=0`.
  const isCleared = value === '' || (maxAge !== null && Number(maxAge.trim()) <= 0)
  if (isCleared) return [name, { kind: COOKIE_CHANGES.cleared }]
  return COOKIE_VALUE.test(value) ? [name, { kind: COOKIE_CHANGES.set, value }] : null
}

/** What a response's `set-cookie` does to the server's cookies; the last word on each one wins. */
export const readServerCookies = (setCookie: string | null): CookieChanges =>
  Object.fromEntries(
    (setCookie ?? '').split(COOKIE_START).flatMap((cookie) => {
      const change = changeOf(cookie)
      return change === null ? [] : [change]
    }),
  )

/** The `Cookie` header's value: the unlock cookie first, then the admin one; null for none. */
export const cookieHeaderOf = (cookies: ServerCookies): string | null => {
  const pairs = COOKIE_NAMES.flatMap((name) => {
    const value = cookies[name]
    return value === undefined ? [] : [`${name}=${value}`]
  })
  return pairs.length === 0 ? null : pairs.join('; ')
}

/** What the store held for a server, read as untrusted: only the server's cookies, well formed. */
const storedCookiesOf = (stored: string | null): ServerCookies => {
  const parsed = ((): unknown => {
    try {
      return JSON.parse(stored ?? '{}')
    } catch {
      return null
    }
  })()
  if (!isRecord(parsed)) return {}
  return Object.fromEntries(
    COOKIE_NAMES.flatMap((name) => {
      const value = parsed[name]
      return isString(value) && COOKIE_VALUE.test(value) ? [[name, value]] : []
    }),
  )
}

type AppliedProps = { cookies: ServerCookies; changes: CookieChanges }

const applied = ({ cookies, changes }: AppliedProps) =>
  Object.fromEntries(
    COOKIE_NAMES.flatMap((name) => {
      const change = changes[name]
      if (change === undefined) return cookies[name] === undefined ? [] : [[name, cookies[name]]]
      return change.kind === COOKIE_CHANGES.set ? [[name, change.value]] : []
    }),
  )

type CreateCookieJarProps = {
  store: SecretStore
  onChange?: (serverId: string) => void
}

/**
 * A jar over `store`, keeping each server's cookies as one JSON value under
 * `raven.cookie.<serverId>`. It reads a server from the store once and keeps it in memory
 * after; a store that fails costs only the cookies' survival across launches. `onChange` hears
 * the server's id each time its cookies change, once memory holds the new ones.
 *
 * Changes to one server's cookies take turns: each reads what the one before it left, so two
 * responses landing together never write over each other.
 */
export const createCookieJar = ({
  store,
  onChange = () => {},
}: CreateCookieJarProps): CookieJar => {
  const known = new Map<string, ServerCookies>()
  const turns = new Map<string, Promise<void>>()

  type InTurnProps = { serverId: string; work: () => Promise<void> }

  const inTurn = ({ serverId, work }: InTurnProps) => {
    const turn = (turns.get(serverId) ?? Promise.resolve()).then(work)
    turns.set(
      serverId,
      turn.catch(() => undefined),
    )
    return turn
  }

  const read = async (serverId: string): Promise<ServerCookies> => {
    const cached = known.get(serverId)
    if (cached !== undefined) return cached
    const stored = await settle({
      work: store.getItemAsync(cookieKeyFor(serverId)),
      fallback: null,
    })
    const cookies = storedCookiesOf(stored)
    known.set(serverId, cookies)
    return cookies
  }

  type WriteProps = { serverId: string; cookies: ServerCookies }

  const write = async ({ serverId, cookies }: WriteProps) => {
    known.set(serverId, cookies)
    onChange(serverId)
    const key = cookieKeyFor(serverId)
    const work =
      Object.keys(cookies).length === 0
        ? store.deleteItemAsync(key)
        : store.setItemAsync(key, JSON.stringify(cookies))
    await settle({ work, fallback: undefined })
  }

  return {
    read,
    forget: (serverId) => inTurn({ serverId, work: () => write({ serverId, cookies: {} }) }),
    apply: ({ serverId, changes }) =>
      inTurn({
        serverId,
        work: async () =>
          write({ serverId, cookies: applied({ cookies: await read(serverId), changes }) }),
      }),
  }
}
