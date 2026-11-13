/** One `name=value` pair of a `Cookie` header, both trimmed. */
export type Cookie = { name: string; value: string }

type ParseCookiesProps = { header: string | undefined }

/** Every cookie in a `Cookie` header, in order, duplicates kept; a part with no `=` is skipped. */
export const parseCookies = ({ header }: ParseCookiesProps): readonly Cookie[] =>
  (header ?? '').split(';').flatMap((part) => {
    const separator = part.indexOf('=')
    if (separator < 0) return []
    return [{ name: part.slice(0, separator).trim(), value: part.slice(separator + 1).trim() }]
  })

type ReadCookieProps = {
  header: string | undefined
  name: string
}

/** The value of the first cookie `name` in a `Cookie` header, or null when it is missing or empty. */
export const readCookie = ({ header, name }: ReadCookieProps): string | null => {
  const value = parseCookies({ header }).find((cookie) => cookie.name === name)?.value ?? ''
  return value === '' ? null : value
}

export const SAME_SITE = { lax: 'Lax', strict: 'Strict' } as const

type SameSite = (typeof SAME_SITE)[keyof typeof SAME_SITE]

type SerializeCookieProps = {
  name: string
  value: string
  path: string
  /** Seconds the browser keeps it, 0 to clear it, or null for a session cookie. */
  maxAgeSeconds: number | null
  /** The parent domain it is shared across, or null to keep it on the host that set it. */
  domain: string | null
  sameSite: SameSite
  isSecure: boolean
}

/** A `Set-Cookie` value. Every cookie the suite sets is `HttpOnly`, so that is not optional. */
export const serializeCookie = ({
  name,
  value,
  path,
  maxAgeSeconds,
  domain,
  sameSite,
  isSecure,
}: SerializeCookieProps): string =>
  [
    `${name}=${value}`,
    `Path=${path}`,
    ...(maxAgeSeconds === null ? [] : [`Max-Age=${maxAgeSeconds}`]),
    ...(domain === null ? [] : [`Domain=${domain}`]),
    'HttpOnly',
    `SameSite=${sameSite}`,
    ...(isSecure ? ['Secure'] : []),
  ].join('; ')
