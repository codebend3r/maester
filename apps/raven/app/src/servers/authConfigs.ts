import {
  AUTH_CONFIG_STATES,
  type ApiClient,
  ApiError,
  type AuthConfig,
  type SignInConfig,
  isSameSignIn,
  signInConfigOf,
  signInHostOf,
} from '@raven/core'

import type { AppServer } from '@/servers/serverList'

/** What a server older than accounts answers `GET /api/auth/config`: there is no such route. */
const NOT_FOUND_STATUS = 404

/**
 * What a server last said of its accounts: `ready`, `off`, `unavailable` (configured but down),
 * or `legacy`, a server older than accounts.
 */
export const ACCOUNT_ANSWERS = {
  ready: 'ready',
  off: 'off',
  unavailable: 'unavailable',
  legacy: 'legacy',
} as const

export type AccountAnswer = (typeof ACCOUNT_ANSWERS)[keyof typeof ACCOUNT_ANSWERS]

/** The answers that send sign-in on to the PIN, as before accounts. */
type AccountlessAnswer = Exclude<AccountAnswer, typeof ACCOUNT_ANSWERS.ready>

/**
 * What sign-in does with a server's auth config: go on to the PIN (`accountless`), sign in at
 * the endpoints the server's pin names (`pinned`, pinned now or already), ask before following
 * the server to endpoints other than its pin's (`moved`), or refuse endpoints the app cannot
 * use (`unusable`).
 */
export const AUTH_READS = {
  accountless: 'accountless',
  pinned: 'pinned',
  moved: 'moved',
  unusable: 'unusable',
} as const

export type AuthRead =
  | { kind: typeof AUTH_READS.accountless; answer: AccountlessAnswer }
  | { kind: typeof AUTH_READS.pinned; account: SignInConfig }
  | { kind: typeof AUTH_READS.moved; account: SignInConfig; host: string; pinnedHost: string }
  | { kind: typeof AUTH_READS.unusable }

const UNUSABLE: AuthRead = { kind: AUTH_READS.unusable }

/** A ready server's endpoints against the pin the app keeps for it. */
const readyReadOf = ({
  config,
  pinned,
}: {
  config: AuthConfig
  pinned: SignInConfig | null
}): AuthRead => {
  const account = signInConfigOf(config)
  if (account === null) return UNUSABLE
  if (pinned === null || isSameSignIn({ a: pinned, b: account })) {
    return { kind: AUTH_READS.pinned, account }
  }
  const host = signInHostOf(account)
  const pinnedHost = signInHostOf(pinned)
  if (host === null || pinnedHost === null) return UNUSABLE
  return { kind: AUTH_READS.moved, account, host, pinnedHost }
}

/**
 * Reads the server's auth config, the first thing sign-in asks, validated at the trust
 * boundary with core's guards: the client's `getAuthConfig` checks the shape, and
 * `signInConfigOf` the endpoints. A 404 is a server older than accounts; any other failure
 * is the call's own, thrown as it came.
 */
export const readAuthConfig = async ({
  api,
  server,
}: {
  api: Pick<ApiClient, 'getAuthConfig'>
  server: Pick<AppServer, 'account'>
}): Promise<AuthRead> => {
  const config = await api.getAuthConfig().catch((error: unknown) => {
    if (error instanceof ApiError && error.status === NOT_FOUND_STATUS) return null
    throw error
  })
  if (config === null) return { kind: AUTH_READS.accountless, answer: ACCOUNT_ANSWERS.legacy }
  switch (config.state) {
    case AUTH_CONFIG_STATES.off:
      return { kind: AUTH_READS.accountless, answer: ACCOUNT_ANSWERS.off }
    case AUTH_CONFIG_STATES.unavailable:
      return { kind: AUTH_READS.accountless, answer: ACCOUNT_ANSWERS.unavailable }
    case AUTH_CONFIG_STATES.ready:
      return readyReadOf({ config, pinned: server.account })
    default: {
      const unreachable: never = config
      return unreachable
    }
  }
}

/** What the server said of its accounts, whatever sign-in made of it. */
export const answerOf = (read: AuthRead): AccountAnswer =>
  read.kind === AUTH_READS.accountless ? read.answer : ACCOUNT_ANSWERS.ready

/**
 * Whether a server signs in with accounts, so the app keeps its admin lock calls from it: as
 * the server last said this run when that was ready, off or no auth route at all, else (not
 * asked yet, or its accounts down) as its pin says, so a server once seen with accounts keeps
 * them. The desktop's rule.
 */
export const hasAccounts = ({
  account,
  answer,
}: {
  account: SignInConfig | null
  answer: AccountAnswer | null
}): boolean => {
  switch (answer) {
    case ACCOUNT_ANSWERS.ready:
      return true
    case ACCOUNT_ANSWERS.off:
    case ACCOUNT_ANSWERS.legacy:
      return false
    case ACCOUNT_ANSWERS.unavailable:
    case null:
      return account !== null
    default: {
      const unreachable: never = answer
      return unreachable
    }
  }
}

/**
 * Whether a server lets the viewer past sign-in: one without accounts always, one with them only
 * while its account is signed in, so a session that ends sends the viewer back to sign in.
 */
export const isLetIn = ({
  account,
  answer,
  isSignedIn,
}: {
  account: SignInConfig | null
  answer: AccountAnswer | null
  isSignedIn: boolean
}): boolean => isSignedIn || !hasAccounts({ account, answer })
