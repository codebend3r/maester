import { AUTH_COOKIE, AUTH_METHODS, isRecord, isString } from '@raven/core'
import { bearerToken, parseCookies } from '@shared/server'

const BASE64_PREFIX = 'base64-'
export const AUTH_ENCODINGS = { base64url: 'base64url', utf8: 'utf8' } as const
const MAX_COOKIE_BYTES = 32_768

const cookieToken = (header: string): string | null => {
  if (header.length > MAX_COOKIE_BYTES) return null
  const entries = parseCookies({ header })
  const whole = entries.filter(({ name }) => name === AUTH_COOKIE)
  const chunks = entries.filter(({ name }) => name.startsWith(`${AUTH_COOKIE}.`))
  if (whole.length > 1 || (whole.length > 0 && chunks.length > 0)) return null
  const sorted = chunks.toSorted(
    (a, b) =>
      Number(a.name.slice(AUTH_COOKIE.length + 1)) - Number(b.name.slice(AUTH_COOKIE.length + 1)),
  )
  if (sorted.some(({ name }, index) => name !== `${AUTH_COOKIE}.${index}`)) return null
  const raw = whole[0]?.value ?? sorted.map(({ value }) => value).join('')
  if (raw === '') return null
  try {
    const decoded = decodeURIComponent(raw)
    const json = decoded.startsWith(BASE64_PREFIX)
      ? Buffer.from(decoded.slice(BASE64_PREFIX.length), AUTH_ENCODINGS.base64url).toString(
          AUTH_ENCODINGS.utf8,
        )
      : decoded
    const session: unknown = JSON.parse(json)
    return isRecord(session) && isString(session.access_token) && session.access_token !== ''
      ? session.access_token
      : null
  } catch {
    return null
  }
}

type AccessTokenOfProps = {
  method: string
  authorization: string | undefined
  cookie: string | undefined
}

export const accessTokenOf = ({
  method,
  authorization,
  cookie,
}: AccessTokenOfProps): string | null => {
  // An explicitly supplied bad Bearer must not fall back to another account's cookie.
  if (authorization !== undefined) return bearerToken({ header: authorization })
  if (method !== AUTH_METHODS.get && method !== AUTH_METHODS.head) return null
  return cookie === undefined ? null : cookieToken(cookie)
}
