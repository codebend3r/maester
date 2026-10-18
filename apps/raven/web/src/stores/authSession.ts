import type { Session } from '@supabase/supabase-js'
import { create } from 'zustand'
import { type AuthClient, type ReadyAuthConfig, createAuthClient } from '@/lib/authClient'

export const AUTH_SESSION_STATUSES = { booting: 'booting', ready: 'ready' } as const
export type AuthSessionStatus = (typeof AUTH_SESSION_STATUSES)[keyof typeof AUTH_SESSION_STATUSES]

/** The two things the app reads off a Supabase session, so no refresh token reaches a component. */
export type SessionSummary = { accessToken: string; userId: string }

type AuthSessionState = {
  client: AuthClient | null
  session: SessionSummary | null
  status: AuthSessionStatus
  /** Builds the client once, reads the stored session and follows every change to it. */
  start: (options: { config: ReadyAuthConfig; createClient?: typeof createAuthClient }) => void
  accessToken: () => string | null
}

const summaryOf = (session: Session | null): SessionSummary | null =>
  session === null ? null : { accessToken: session.access_token, userId: session.user.id }

/** Who is signed in on this browser, and the token every `/api/` call carries. */
export const useAuthSession = create<AuthSessionState>()((set, get) => ({
  client: null,
  session: null,
  status: AUTH_SESSION_STATUSES.booting,
  start: ({ config, createClient = createAuthClient }) => {
    if (get().client !== null) return
    const client = createClient({ config })
    set({ client })
    client.onAuthStateChange((_event, session) => set({ session: summaryOf(session) }))
    const settle = (session: Session | null) =>
      set({ session: summaryOf(session), status: AUTH_SESSION_STATUSES.ready })
    client.getSession().then(
      ({ data }) => settle(data.session),
      () => settle(null),
    )
  },
  accessToken: () => get().session?.accessToken ?? null,
}))
