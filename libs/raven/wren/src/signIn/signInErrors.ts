import {
  SIGN_IN_ERRORS,
  type SignInError,
  type SignInErrorCopy,
  signInErrorTextOf,
} from '@raven/core'
import { SIGN_IN_COPY } from '@/copy/screens'

/*
 * What each sign-in error says in Wren; a refusal says the service's or the server's own words.
 * `full` and `notAdded` are of the phone's server list, which the web has none of and never says.
 */
const SIGN_IN_ERROR_COPY = {
  [SIGN_IN_ERRORS.missing]: SIGN_IN_COPY.badAccount,
  [SIGN_IN_ERRORS.badCredentials]: SIGN_IN_COPY.wrongAccount,
  [SIGN_IN_ERRORS.unreachable]: SIGN_IN_COPY.unreachable,
  [SIGN_IN_ERRORS.full]: SIGN_IN_COPY.full,
  [SIGN_IN_ERRORS.notAdded]: SIGN_IN_COPY.notAdded,
} as const satisfies SignInErrorCopy

/** What sign-in says went wrong: the banner over the button and each field's own line. */
type SignInErrors = {
  banner: string | null
  email: string | null
  password: string | null
}

type SignInErrorsOfProps = { error: SignInError | null; email: string; password: string }

/**
 * Reads the flow's one error onto the screen. A submit with a field left empty marks each empty
 * field, until something is typed in it, under the banner; every other error is the banner
 * alone.
 */
export const signInErrorsOf = ({ error, email, password }: SignInErrorsOfProps): SignInErrors => {
  const isMissing = (error?.kind ?? null) === SIGN_IN_ERRORS.missing
  return {
    banner: error === null ? null : signInErrorTextOf({ error, copy: SIGN_IN_ERROR_COPY }),
    email: isMissing && email.trim() === '' ? SIGN_IN_COPY.enterEmail : null,
    password: isMissing && password === '' ? SIGN_IN_COPY.enterPassword : null,
  }
}
