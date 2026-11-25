import type { AuthChangeEvent, Session } from '@supabase/supabase-js'
import { AUTH_CONFIG_STATES, AUTH_COOKIE, type ReadyAuthConfig } from '@raven/core'
import type { AuthClient } from '@/lib/authClient'
import type { SessionSummary } from '@/stores/authSession'

/** What the server says about accounts when they are on, pointing at the local stack. */
export const readyConfig: ReadyAuthConfig = {
  state: AUTH_CONFIG_STATES.ready,
  supabaseUrl: 'http://127.0.0.1:54321',
  publishableKey: 'sb_publishable_test',
  webUrl: 'http://localhost:5185',
  cookieName: AUTH_COOKIE,
}

/** The cookies of a browser that holds a Supabase session, so the session waits for the client to read it. */
export const SESSION_COOKIES = `${AUTH_COOKIE}=base64-test`

const LISTENER_ID = '0b8e6f2a-4c1d-4e3b-9a7f-5d2c1e8b6a40'

/** The session store's view of the listener signed in. */
export const SIGNED_IN: SessionSummary = { accessToken: 't', userId: LISTENER_ID }

type FakeSessionProps = { userId?: string; accessToken?: string }

export const fakeSession = ({
  userId = LISTENER_ID,
  accessToken = 'access-token',
}: FakeSessionProps = {}): Session => ({
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

type FakeAuthClientProps = { session?: Session | null; calls?: Partial<AuthClient> }

type EmitProps = { event: AuthChangeEvent; session: Session | null }

/**
 * An auth client that answers `getSession` with `session` and tells whoever listened about the
 * events `emit` sends; every other call fails the test unless `calls` answers it.
 */
export const fakeAuthClient = ({ session = null, calls = {} }: FakeAuthClientProps = {}) => {
  const listeners = new Set<Listener>()
  const client: AuthClient = {
    signInWithPassword: unused,
    signOut: unused,
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
    emit: ({ event, session: next }: EmitProps) =>
      listeners.forEach((listener) => listener(event, next)),
  }
}
