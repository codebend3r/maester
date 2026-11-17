/**
 * Why a sign-in failed: a field left empty, a wrong email or password, raven or its account
 * service out of reach, a server that could not be kept, or a refusal in the service's or the
 * server's own words.
 */
export const SIGN_IN_ERRORS = {
  missing: 'missing',
  badCredentials: 'badCredentials',
  unreachable: 'unreachable',
  full: 'full',
  notAdded: 'notAdded',
  refused: 'refused',
} as const

type SignInErrorKind = (typeof SIGN_IN_ERRORS)[keyof typeof SIGN_IN_ERRORS]

/** The errors each app says in its own words: every one but a refusal, which says its own. */
type WordedErrorKind = Exclude<SignInErrorKind, typeof SIGN_IN_ERRORS.refused>

export type SignInError =
  | { kind: WordedErrorKind }
  | { kind: typeof SIGN_IN_ERRORS.refused; message: string }

/** Each app's words for the errors it names. */
export type SignInErrorCopy = Record<WordedErrorKind, string>

/** Supabase Auth's `error_code` for a wrong email or password. */
export const AUTH_ERROR_CODES = { invalidCredentials: 'invalid_credentials' } as const

type SignInErrorTextOfProps = { error: SignInError; copy: SignInErrorCopy }

/** What an error says: the app's words for it, or a refusal's own. */
export const signInErrorTextOf = ({ error, copy }: SignInErrorTextOfProps): string =>
  error.kind === SIGN_IN_ERRORS.refused ? error.message : copy[error.kind]
