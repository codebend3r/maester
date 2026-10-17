export const SERVER_COOKIES = ['raven_unlock', 'raven_admin'] as const

// The server signs both values in base64url with `.` between the parts; anything wider,
// a `,`, `;`, space or line break above all, would split the header or add one.
const COOKIE_VALUE = /^[A-Za-z0-9._~-]+$/u

/**
 * The `Cookie` header mpv sends for a server's file: `raven_unlock` and `raven_admin`
 * only, the first well-formed value of each, or null when there are none.
 */
export const cookieHeader = (
  cookies: readonly { name: string; value: string }[],
): string | null => {
  const pairs = SERVER_COOKIES.flatMap((name) => {
    const found = cookies.find((cookie) => cookie.name === name && COOKIE_VALUE.test(cookie.value))
    return found === undefined ? [] : [`${name}=${found.value}`]
  })
  return pairs.length === 0 ? null : `Cookie: ${pairs.join('; ')}`
}
