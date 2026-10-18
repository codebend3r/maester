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

export const HOME_PATH = '/'
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
  if (!value?.startsWith('/') || value.startsWith('//')) return HOME_PATH
  if (value.includes('\\') || hasControlCharacter(value)) return HOME_PATH
  const { origin } = window.location
  const url = URL.parse(value, origin)
  if (!url || url.origin !== origin) return HOME_PATH
  return isAuthPath(url.pathname) ? HOME_PATH : value
}

export const signInPath = ({ returnTo }: { returnTo: string }): string =>
  `${AUTH_ROUTES.signIn}?${new URLSearchParams({ [AUTH_QUERY.returnTo]: returnTo })}`

export const checkEmailPath = ({ email }: { email: string }): string =>
  `${AUTH_ROUTES.checkEmail}?${new URLSearchParams({ [AUTH_QUERY.email]: email })}`

/** Where an email link lands: raven's confirm route on its own web address. */
export const confirmUrl = ({ webUrl }: { webUrl: string }): string =>
  `${webUrl.replace(/\/+$/, '')}${AUTH_ROUTES.confirm}`
