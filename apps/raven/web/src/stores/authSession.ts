import type { Session } from '@supabase/supabase-js'
import { create } from 'zustand'
import {
  type AuthClient,
  type ReadyAuthConfig,
  AUTH_EVENTS,
  createAuthClient,
} from '@/lib/authClient'
import { clearAccountState } from '@/lib/clearAccountState'
import { queryClient, queryKeys } from '@/lib/queryClient'

export const AUTH_SESSION_STATUSES = { booting: 'booting', ready: 'ready' } as const
export type AuthSessionStatus = (typeof AUTH_SESSION_STATUSES)[keyof typeof AUTH_SESSION_STATUSES]

/** The two things the app reads off a Supabase session, so no refresh token reaches a component. */
export type SessionSummary = { accessToken: string; userId: string }

type AuthSessionState = {
  client: AuthClient | null
  session: SessionSummary | null
  status: AuthSessionStatus
  /**
   * Whether the session came from a recovery link opened in this tab. Supabase
   * announces that once, as `PASSWORD_RECOVERY`, so a reload forgets it and the
   * visitor asks for a new link.
   */
  isRecovery: boolean
  endRecovery: () => void
  /** Builds the client once, reads the stored session and follows every change to it. */
  start: (options: { config: ReadyAuthConfig; createClient?: typeof createAuthClient }) => void
  accessToken: () => string | null
}

const summaryOf = (session: Session | null): SessionSummary | null =>
  session === null ? null : { accessToken: session.access_token, userId: session.user.id }

/**
 * What the previous account left behind is dropped whenever the account
 * changes, a sign out in another tab or an expired session included. A first
 * sign in after nobody was signed in keeps the cache but marks it stale: the
 * server refused what was asked for before, and the account query is keyed by
 * user, so nothing of another account can show.
 */
const followAccount = ({
  previous,
  next,
}: {
  previous: SessionSummary | null
  next: SessionSummary | null
}): void => {
  if (previous?.userId === next?.userId) return
  if (previous !== null) {
    clearAccountState({ queryClient })
    return
  }
  void queryClient.invalidateQueries({
    predicate: (query) => query.queryKey[0] !== queryKeys.auth[0],
  })
}

/** Who is signed in on this browser, and the token every `/api/` call carries. */
export const useAuthSession = create<AuthSessionState>()((set, get) => ({
  client: null,
  session: null,
  status: AUTH_SESSION_STATUSES.booting,
  isRecovery: false,
  endRecovery: () => set({ isRecovery: false }),
  start: ({ config, createClient = createAuthClient }) => {
    if (get().client !== null) return
    const client = createClient({ config })
    set({ client })
    client.onAuthStateChange((event, session) => {
      const previous = get().session
      const next = summaryOf(session)
      set({
        session: next,
        isRecovery:
          next !== null &&
          (event === AUTH_EVENTS.passwordRecovery ||
            (get().isRecovery && previous?.userId === next.userId)),
      })
      followAccount({ previous, next })
    })
    const settle = (session: Session | null) =>
      set({ session: summaryOf(session), status: AUTH_SESSION_STATUSES.ready })
    client.getSession().then(
      ({ data }) => settle(data.session),
      () => settle(null),
    )
  },
  accessToken: () => get().session?.accessToken ?? null,
}))
