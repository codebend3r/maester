import { SIGN_IN_FAILURES } from '@/lib/signIn'

export const SIGN_IN_COPY = {
  heading: 'Sign in to sparrow',
  lede: 'Use your raven account.',
  email: 'Email',
  password: 'Password',
  signIn: 'Sign in',
  signingIn: 'Signing in…',
} as const

/** What each failure says; a refusal says Supabase's own words instead. */
export const SIGN_IN_FAILURE_COPY = {
  [SIGN_IN_FAILURES.missing]: 'Enter your email and password.',
  [SIGN_IN_FAILURES.badCredentials]: "That email and password don't match a raven account.",
  [SIGN_IN_FAILURES.unreachable]: "Couldn't reach sign-in. Try again in a moment.",
} as const
