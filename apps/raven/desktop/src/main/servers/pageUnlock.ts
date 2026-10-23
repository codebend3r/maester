import { PAGE_ORIGIN, UNLOCK_COOKIE, UNLOCK_COOKIE_PATH } from '@raven/core'
import { loggable } from '@/main/servers/serverCalls'
import { messageOf } from '@/shared/messageOf'

/** The part of the page session's cookie jar main reads, as Electron's `session.cookies` has it. */
export type PageCookies = {
  get: (filter: { url: string; name: string }) => Promise<readonly { value: string }[]>
}

const MAX_VALUE_CHARS = 4096

/** The characters RFC 6265 lets a cookie value hold, as ranges of char codes. */
const COOKIE_OCTETS = [
  [0x21, 0x21],
  [0x23, 0x2b],
  [0x2d, 0x3a],
  [0x3c, 0x5b],
  [0x5d, 0x7e],
] as const

/** RFC 6265's cookie-octets only, so a value can neither end the header nor start another cookie. */
const isCookieValue = (value: string): boolean =>
  value.length > 0 &&
  value.length <= MAX_VALUE_CHARS &&
  [...value].every((char) => {
    const code = char.codePointAt(0) ?? 0
    return COOKIE_OCTETS.some(([low, high]) => code >= low && code <= high)
  })

/**
 * The `Cookie` header that carries the page's library PIN unlock on main's own calls to the
 * server. The page enters the PIN, so main reads its cookie from the page's jar on every call,
 * and a lock or an unlock there counts at once. Null when the page holds none, or the jar
 * cannot be read.
 */
export const createPageUnlock =
  ({
    cookies,
    warn,
  }: {
    cookies: PageCookies
    warn: (message: string) => void
  }): (() => Promise<string | null>) =>
  async () => {
    try {
      const found = await cookies.get({
        url: `${PAGE_ORIGIN}${UNLOCK_COOKIE_PATH}`,
        name: UNLOCK_COOKIE,
      })
      const value = found[0]?.value ?? null
      return value !== null && isCookieValue(value) ? `${UNLOCK_COOKIE}=${value}` : null
    } catch (error) {
      warn(`Raven could not read the page's unlock: ${loggable(messageOf(error))}`)
      return null
    }
  }
