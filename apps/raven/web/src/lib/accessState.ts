import { useQuery } from '@tanstack/react-query'
import {
  type Account,
  type AuthConfig,
  ApiError,
  AUTH_CONFIG_STATES,
  AUTH_REFUSALS,
  MEMBER_STATUSES,
} from '@raven/core'
import { accountQuery, authConfigQuery } from '@/lib/queries'
import { type AuthSessionState, AUTH_SESSION_STATUSES, useAuthSession } from '@/stores/authSession'

export const ACCESS_KINDS = {
  disabled: 'disabled',
  unavailable: 'unavailable',
  loading: 'loading',
  signedOut: 'signedOut',
  failed: 'failed',
  pending: 'pending',
  revoked: 'revoked',
  approved: 'approved',
} as const

/** Where the viewer stands: what the route guard switches on. */
export type AccessState =
  | { kind: typeof ACCESS_KINDS.disabled }
  | { kind: typeof ACCESS_KINDS.unavailable }
  | { kind: typeof ACCESS_KINDS.loading }
  | { kind: typeof ACCESS_KINDS.signedOut }
  | { kind: typeof ACCESS_KINDS.failed }
  | { kind: typeof ACCESS_KINDS.pending }
  | { kind: typeof ACCESS_KINDS.revoked }
  | { kind: typeof ACCESS_KINDS.approved; account: Account }

export type AccessKind = AccessState['kind']

/** What `accessStateOf` reads of a query; a `useQuery` result is one. */
type QueryView<T> = { data: T | undefined; error: Error | null }

type SessionView = Pick<AuthSessionState, 'status' | 'session'>

const accountState = (account: QueryView<Account>): AccessState => {
  const reason = account.error instanceof ApiError ? account.error.refusal?.reason : undefined
  switch (reason) {
    case AUTH_REFUSALS.signedOut:
      return { kind: ACCESS_KINDS.signedOut }
    case AUTH_REFUSALS.pending:
      return { kind: ACCESS_KINDS.pending }
    case AUTH_REFUSALS.revoked:
      return { kind: ACCESS_KINDS.revoked }
    case AUTH_REFUSALS.notOwner:
    case AUTH_REFUSALS.unavailable:
    case undefined:
      break
    default: {
      const unreachable: never = reason
      return unreachable
    }
  }
  if (account.data === undefined) {
    return { kind: account.error ? ACCESS_KINDS.failed : ACCESS_KINDS.loading }
  }
  switch (account.data.status) {
    case MEMBER_STATUSES.approved:
      return { kind: ACCESS_KINDS.approved, account: account.data }
    case MEMBER_STATUSES.pending:
      return { kind: ACCESS_KINDS.pending }
    case MEMBER_STATUSES.revoked:
      return { kind: ACCESS_KINDS.revoked }
    default: {
      const unreachable: never = account.data.status
      return unreachable
    }
  }
}

type AccessStateOfProps = {
  config: QueryView<AuthConfig>
  session: SessionView
  account: QueryView<Account>
}

/**
 * Whether the viewer may see raven, from what the server says about accounts,
 * who is signed in and what `/api/me` answered. A failure to reach the server
 * is `failed`, never `signedOut`, so an outage does not sign anyone out; an
 * account already read stays through a failed read of it, but not through a
 * refusal.
 */
export const accessStateOf = ({ config, session, account }: AccessStateOfProps): AccessState => {
  if (config.data === undefined) {
    return { kind: config.error ? ACCESS_KINDS.failed : ACCESS_KINDS.loading }
  }
  switch (config.data.state) {
    case AUTH_CONFIG_STATES.off:
      return { kind: ACCESS_KINDS.disabled }
    case AUTH_CONFIG_STATES.unavailable:
      return { kind: ACCESS_KINDS.unavailable }
    case AUTH_CONFIG_STATES.ready:
      break
    default: {
      const unreachable: never = config.data
      return unreachable
    }
  }
  if (session.status === AUTH_SESSION_STATUSES.booting) return { kind: ACCESS_KINDS.loading }
  if (session.session === null) return { kind: ACCESS_KINDS.signedOut }
  return accountState(account)
}

/** The signed-in account's `/api/me`, asked for only while accounts are on and someone is signed in. */
export const useAccount = () => {
  const config = useQuery(authConfigQuery)
  const session = useAuthSession((state) => state.session)
  const isReady = config.data?.state === AUTH_CONFIG_STATES.ready
  return useQuery(accountQuery(isReady ? (session?.userId ?? null) : null))
}

export const useAccessState = (): AccessState => {
  const config = useQuery(authConfigQuery)
  const status = useAuthSession((state) => state.status)
  const session = useAuthSession((state) => state.session)
  const account = useAccount()
  return accessStateOf({ config, session: { status, session }, account })
}

/** Whether the server answers the viewer's calls: accounts are off, or the account is approved. */
export const useIsServed = (): boolean => {
  const { kind } = useAccessState()
  return kind === ACCESS_KINDS.disabled || kind === ACCESS_KINDS.approved
}
