import type { Session } from '@supabase/supabase-js'
import { create } from 'zustand'
import type { ReadyAuthConfig } from '@/lib/api'
import { type AuthClient, createAuthClient } from '@/lib/authClient'

export const AUTH_SESSION_STATUSES = { booting: 'booting', ready: 'ready' } as const

type AuthSessionStatus = (typeof AUTH_SESSION_STATUSES)[keyof typeof AUTH_SESSION_STATUSES]

/** The two things the page reads off a Supabase session, so no refresh token reaches a component. */
type SessionSummary = { accessToken: string; userId: string }

type CreateClient = typeof createAuthClient

type StartProps = { config: ReadyAuthConfig; createClient?: CreateClient }

type AuthSessionState = {
  /** The client on its way; null before `start`, which runs once, and resolving null when it could not load. */
  clientLoad: Promise<AuthClient | null> | null
  session: SessionSummary | null
  /** `booting` until the session kept in the browser has been read. */
  status: AuthSessionStatus
  /** Builds the client once, reads the session the browser keeps and follows every change to it. */
  start: (options: StartProps) => Promise<AuthClient | null>
  /** Takes a session as the one signed in, as a change Supabase announces is taken. */
  take: (session: Session | null) => void
}

const summaryOf = (session: Session | null): SessionSummary | null =>
  session === null ? null : { accessToken: session.access_token, userId: session.user.id }

/** Who is signed in on this browser, and the token every `/api/` call carries. */
export const useAuthSession = create<AuthSessionState>()((set, get) => ({
  clientLoad: null,
  session: null,
  status: AUTH_SESSION_STATUSES.booting,
  start: ({ config, createClient = createAuthClient }) => {
    const started = get().clientLoad
    if (started !== null) return started
    // A store emptied while Supabase's code loads (a test's reset) has moved on.
    const settle = (session: Session | null) => {
      if (get().clientLoad === null) return
      set({ session: summaryOf(session), status: AUTH_SESSION_STATUSES.ready })
    }
    const follow = (client: AuthClient): AuthClient => {
      if (get().clientLoad === null) return client
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
    return clientLoad
  },
  take: (session) => set({ session: summaryOf(session) }),
}))
