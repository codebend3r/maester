export const AUTH_ROUTES = {
  signIn: '/sign-in',
  signUp: '/sign-up',
  checkEmail: '/check-email',
  confirm: '/auth/confirm',
  forgot: '/forgot-password',
  reset: '/reset-password',
  pending: '/pending',
} as const

export const AUTH_QUERY = {
  returnTo: 'return_to',
  tokenHash: 'token_hash',
  type: 'type',
  email: 'email',
} as const

const HOME = '/'
const DELETE_CHARACTER = 0x7f
const FIRST_PRINTABLE = 0x20

const hasControlCharacter = (value: string): boolean =>
  Array.from(value).some((character) => {
    const code = character.charCodeAt(0)
    return code < FIRST_PRINTABLE || code === DELETE_CHARACTER
  })

const isAuthPath = (pathname: string): boolean => {
  const normalised = pathname.toLowerCase().replace(/\/+$/, '')
  return Object.values(AUTH_ROUTES).some((route) => route === normalised)
}

/**
 * A same-origin path to return to after signing in, or home. Anything that
 * could leave the origin, or lands on an auth page, is refused.
 */
export const safeReturnPath = (value: string | null): string => {
  if (!value?.startsWith('/') || value.startsWith('//')) return HOME
  if (value.includes('\\') || hasControlCharacter(value)) return HOME
  const { origin } = window.location
  const url = URL.parse(value, origin)
  if (!url || url.origin !== origin) return HOME
  return isAuthPath(url.pathname) ? HOME : value
}

export const signInPath = ({ returnTo }: { returnTo: string }): string =>
  `${AUTH_ROUTES.signIn}?${new URLSearchParams({ [AUTH_QUERY.returnTo]: returnTo })}`
