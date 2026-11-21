import { AUTH_CONFIG_STATES, type AuthConfig } from '@raven/core'
import { useQuery } from '@tanstack/react-query'
import { queries } from '@/lib/queries'
import {
  AUTH_SESSION_STATUSES,
  type AuthSessionStatus,
  type SessionSummary,
  useAuthSession,
} from '@/stores/authSession'

/**
 * Where the listener stands: still being read, let in (signed in, or on a server with accounts
 * off, which has no sign-in, as the apps open straight to Home under their bypass), or signed out.
 */
export const ACCESS_KINDS = { loading: 'loading', open: 'open', signedOut: 'signedOut' } as const

export type AccessKind = (typeof ACCESS_KINDS)[keyof typeof ACCESS_KINDS]

/** What `accessOf` reads of the config's query; a `useQuery` result is one. */
type ConfigView = { data: AuthConfig | undefined; error: Error | null }

type SessionAccessOfProps = {
  status: AuthSessionStatus
  session: SessionSummary | null
}

type AccessOfProps = SessionAccessOfProps & { config: ConfigView }

/** With accounts on: waiting until the session is read, then let in only when someone is signed in. */
const sessionAccessOf = ({ status, session }: SessionAccessOfProps): AccessKind => {
  if (status === AUTH_SESSION_STATUSES.booting) return ACCESS_KINDS.loading
  return session === null ? ACCESS_KINDS.signedOut : ACCESS_KINDS.open
}

/**
 * Whether the listener may see their music, from what the server says about accounts and who is
 * signed in. A server out of reach, or one whose accounts cannot be read, sends the listener to
 * sign-in, which says raven cannot be reached when they try.
 */
export const accessOf = ({ config, status, session }: AccessOfProps): AccessKind => {
  if (config.data === undefined) {
    return config.error === null ? ACCESS_KINDS.loading : ACCESS_KINDS.signedOut
  }
  switch (config.data.state) {
    case AUTH_CONFIG_STATES.off:
      return ACCESS_KINDS.open
    case AUTH_CONFIG_STATES.unavailable:
      return ACCESS_KINDS.signedOut
    case AUTH_CONFIG_STATES.ready:
      return sessionAccessOf({ status, session })
    default: {
      const unknown: never = config.data
      return unknown
    }
  }
}

/** Where the listener stands now. */
export const useAccess = (): AccessKind => {
  const config = useQuery(queries.authConfigQuery)
  const status = useAuthSession((state) => state.status)
  const session = useAuthSession((state) => state.session)
  return accessOf({ config, status, session })
}
