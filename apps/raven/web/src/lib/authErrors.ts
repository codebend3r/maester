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

/**
 * What a password must hold, in plain words. The rules are the ones
 * `minimum_password_length` and `password_requirements` set in
 * `apps/raven/supabase/config.toml`; change both together.
 */
export const PASSWORD_COPY = {
  rules:
    'Use at least 10 characters, including a lowercase letter, an uppercase letter and a number.',
  breached: 'This password has appeared in a data breach. Choose a different one.',
} as const

/** Why Supabase calls a password weak: too short, missing a kind of character, or leaked. */
const WEAK_PASSWORD_REASONS = { pwned: 'pwned' } as const

const reasonsOf = (error: unknown): unknown[] =>
  typeof error === 'object' && error !== null && 'reasons' in error && Array.isArray(error.reasons)
    ? error.reasons
    : []

/**
 * A weak password refusal in plain words, instead of Supabase's own, which
 * lists every allowed character. A password that only failed for appearing
 * in a breach says so; anything else states the rules.
 */
export const weakPasswordMessage = (error: unknown): string | null => {
  if (errorCodeOf(error) !== AUTH_ERRORS.weakPassword) return null
  const reasons = reasonsOf(error)
  const isOnlyBreached =
    reasons.length > 0 && reasons.every((reason) => reason === WEAK_PASSWORD_REASONS.pwned)
  return isOnlyBreached ? PASSWORD_COPY.breached : PASSWORD_COPY.rules
}
