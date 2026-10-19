/** The `code`s of the Supabase auth errors raven tells apart. */
export const AUTH_ERRORS = {
  invalidCredentials: 'invalid_credentials',
  emailNotConfirmed: 'email_not_confirmed',
  userAlreadyExists: 'user_already_exists',
  otpExpired: 'otp_expired',
  overEmailSendRateLimit: 'over_email_send_rate_limit',
  weakPassword: 'weak_password',
} as const

export const RATE_LIMITED_COPY = 'Wait a moment before asking again.'

/** The `code` a Supabase auth error carries; a network failure has none. */
export const errorCodeOf = (error: unknown): unknown =>
  typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined

export const isRateLimited = (error: unknown): boolean =>
  errorCodeOf(error) === AUTH_ERRORS.overEmailSendRateLimit

export const resendFailureCopy = (error: unknown): string =>
  isRateLimited(error) ? RATE_LIMITED_COPY : 'Could not resend. Try again.'

/** The server's own words for a weak password, which tell the visitor what to fix. */
export const weakPasswordMessage = (error: unknown): string | null =>
  errorCodeOf(error) === AUTH_ERRORS.weakPassword && error instanceof Error && error.message !== ''
    ? error.message
    : null
