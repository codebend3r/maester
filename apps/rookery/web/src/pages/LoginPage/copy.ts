import { AUTH_ERRORS, type AuthErrorCode } from '@/lib/api'

export const LOGIN_PAGE_COPY = {
  title: 'Sign in',
  lede: 'One sign-in for sparrow and the rest of maester, with your Plex account.',
  opening: 'Opening Plex…',
  signIn: 'Sign in with Plex',
} as const

/** What went wrong, keyed by the `error` the server puts on `/login`, or by `AuthError.code`. */
export const ERROR_MESSAGES = {
  [AUTH_ERRORS.notApproved]:
    'Plex did not confirm the sign-in. Try again, and approve it on the Plex page.',
  [AUTH_ERRORS.expired]:
    'That sign-in ran out of time, or was started in another browser. Try again.',
  [AUTH_ERRORS.plexUnavailable]: 'Plex is not answering right now. Try again in a minute.',
  [AUTH_ERRORS.unreachable]: 'rookery could not start the sign-in. Try again.',
} as const satisfies Record<AuthErrorCode, string>
