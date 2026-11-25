import type { Session } from '@supabase/supabase-js'
import { type ReadyAuthConfig, hasSessionCookie } from '@raven/core'
import { queryKeys } from '@raven/ui/headless'
import { create } from 'zustand'
import { type AuthClient, createAuthClient } from '@/lib/authClient'
import { clearAccountState } from '@/lib/clearAccountState'
import { queryClient } from '@/lib/queryClient'

export const AUTH_SESSION_STATUSES = { booting: 'booting', ready: 'ready' } as const

export type AuthSessionStatus = (typeof AUTH_SESSION_STATUSES)[keyof typeof AUTH_SESSION_STATUSES]

/** The two things Wren reads off a Supabase session, so no refresh token reaches a component. */
export type SessionSummary = { accessToken: string; userId: string }

type CreateClient = (input: Parameters<typeof createAuthClient>[0]) => Promise<AuthClient>

type StartProps = {
  config: ReadyAuthConfig
  createClient?: CreateClient
  /** `document.cookie`, read when the session starts. */
  cookies?: string
}

type AuthSessionState = {
  client: AuthClient | null
  /** The client on its way; null before `start`, which runs once, and resolving null when it could not load. */
  clientLoad: Promise<AuthClient | null> | null
  session: SessionSummary | null
  status: AuthSessionStatus
  /**
   * Builds the client once, reads the session the cookie holds and follows every change to it.
   * It answers the client on its way, for a sign-in pressed before it has loaded.
   */
  start: (options: StartProps) => Promise<AuthClient | null>
  /** Takes a session as the one signed in, as a change Supabase announces is taken. */
  take: (session: Session | null) => void
}

const summaryOf = (session: Session | null): SessionSummary | null =>
  session === null ? null : { accessToken: session.access_token, userId: session.user.id }

type FollowAccountProps = { previous: SessionSummary | null; next: SessionSummary | null }

/*
 * What the previous account left behind, its answers and its queue, is dropped whenever the
 * account changes, a sign out in another tab or an expired session included; a renewed token
 * keeps both. A first sign in after nobody was signed in keeps the cache but marks it stale, as
 * the server refused what was asked for before. It runs inside Supabase's auth listener, which
 * must not wait on anything, so a refetch that fails is left to the queries that show it.
 */
const followAccount = ({ previous, next }: FollowAccountProps): void => {
  if ((previous?.userId ?? null) === (next?.userId ?? null)) return
  if (previous !== null) {
    clearAccountState({ queryClient }).catch(() => undefined)
    return
  }
  queryClient
    .invalidateQueries({ predicate: (query) => query.queryKey[0] !== queryKeys.auth[0] })
    .catch(() => undefined)
}

/** Who is signed in on this browser, and the token every `/api/` call carries. */
export const useAuthSession = create<AuthSessionState>()((set, get) => ({
  client: null,
  clientLoad: null,
  session: null,
  status: AUTH_SESSION_STATUSES.booting,
  start: ({ config, createClient = createAuthClient, cookies = document.cookie }) => {
    const started = get().clientLoad
    if (started !== null) return started
    // A store emptied while Supabase's code loads (a test's reset) has moved on.
    const settle = (session: Session | null) => {
      if (get().clientLoad === null) return
      set({ session: summaryOf(session), status: AUTH_SESSION_STATUSES.ready })
    }
    const follow = (client: AuthClient): AuthClient => {
      if (get().clientLoad === null) return client
      set({ client })
      client.onAuthStateChange((_event, session) => get().take(session))
      client.getSession().then(
        ({ data }) => settle(data.session),
        () => settle(null),
      )
      return client
    }
    // Supabase's code failing to load leaves nobody signed in, as a session that fails to read does.
    const clientLoad = createClient({ config }).then(follow, () => {
      settle(null)
      return null
    })
    set({ clientLoad })
    // With no session cookie nobody is signed in, so sign-in draws without waiting for the client.
    if (!hasSessionCookie({ cookies, cookieName: config.cookieName })) settle(null)
    return clientLoad
  },
  take: (session) => {
    const previous = get().session
    const next = summaryOf(session)
    set({ session: next })
    followAccount({ previous, next })
  },
}))
