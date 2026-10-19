import type { AuthChangeEvent, Session } from '@supabase/supabase-js'
import type { Account } from '@raven/core'
import { AUTH_CONFIG_STATES, AUTH_COOKIE, MEMBER_STATUSES } from '@raven/core'
import type { AuthClient, ReadyAuthConfig } from '@/lib/authClient'
import type { SessionSummary } from '@/stores/authSession'

/** What the server says about accounts when they are on, pointing at the local stack. */
export const readyConfig: ReadyAuthConfig = {
  state: AUTH_CONFIG_STATES.ready,
  supabaseUrl: 'http://127.0.0.1:54321',
  publishableKey: 'sb_publishable_test',
  webUrl: 'http://localhost:8484',
  cookieName: AUTH_COOKIE,
}

export const ACCOUNT_ID = '0b8e6f2a-4c1d-4e3b-9a7f-5d2c1e8b6a40'

/** The session store's view of `fakeAccount` signed in. */
export const SIGNED_IN: SessionSummary = { accessToken: 't', userId: ACCOUNT_ID }

export const fakeAccount = (overrides: Partial<Account> = {}): Account => ({
  id: ACCOUNT_ID,
  email: 'viewer@example.com',
  status: MEMBER_STATUSES.approved,
  isOwner: false,
  ...overrides,
})

export const fakeSession = ({
  userId = ACCOUNT_ID,
  accessToken = 'access-token',
}: {
  userId?: string
  accessToken?: string
} = {}): Session => ({
  access_token: accessToken,
  refresh_token: 'refresh-token',
  expires_in: 3600,
  token_type: 'bearer',
  user: {
    id: userId,
    aud: 'authenticated',
    app_metadata: {},
    user_metadata: {},
    created_at: '2026-10-18T00:00:00Z',
  },
})

const unused = async (): Promise<never> => {
  throw new Error('The test did not expect this call')
}

type Listener = (event: AuthChangeEvent, session: Session | null) => void

/**
 * An auth client that answers `getSession` with `session` and tells whoever
 * listened about the events `emit` sends; every other call fails the test
 * unless `calls` answers it.
 */
export const fakeAuthClient = ({
  session = null,
  calls = {},
}: { session?: Session | null; calls?: Partial<AuthClient> } = {}) => {
  const listeners = new Set<Listener>()
  const client: AuthClient = {
    signInWithPassword: unused,
    signUp: unused,
    signOut: unused,
    resend: unused,
    resetPasswordForEmail: unused,
    updateUser: unused,
    verifyOtp: unused,
    refreshSession: unused,
    getSession: async () =>
      session === null
        ? { data: { session: null }, error: null }
        : { data: { session }, error: null },
    onAuthStateChange: (listener) => {
      listeners.add(listener)
      return {
        data: {
          subscription: {
            id: Symbol('listener'),
            callback: listener,
            unsubscribe: () => listeners.delete(listener),
          },
        },
      }
    },
    ...calls,
  }
  return {
    client,
    listenerCount: () => listeners.size,
    emit: ({ event, session: next }: { event: AuthChangeEvent; session: Session | null }) =>
      listeners.forEach((listener) => listener(event, next)),
  }
}
