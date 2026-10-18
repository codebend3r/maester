import { AUTH_ERRORS } from '@/lib/authClient'

export const RATE_LIMITED_COPY = 'Wait a moment before asking again.'

/** The `code` a Supabase auth error carries; a network failure has none. */
export const errorCodeOf = (error: unknown): unknown =>
  typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined

const isRateLimited = (error: unknown): boolean =>
  errorCodeOf(error) === AUTH_ERRORS.overEmailSendRateLimit

export const resendFailureCopy = (error: unknown): string =>
  isRateLimited(error) ? RATE_LIMITED_COPY : 'Could not resend. Try again.'
