import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'

import {
  AUTH_OUTCOMES,
  type AccountSession,
  type AuthOutcome,
  isAccountSession,
  refreshSession,
  signInWithPassword,
} from '@/account/supabaseAuth'
import { secretStore } from '@/servers/deviceSecretStore'
import { secretStateStorage } from '@/servers/secretStore'
import { RAVEN_SERVER } from '@/servers/ravenServer'

type AccountSessionState = {
  session: AccountSession | null
  signIn: (input: { email: string; password: string }) => Promise<AuthOutcome>
  /** A new access token, or null when there is none to give (signed out, or Supabase unreachable). */
  refresh: () => Promise<string | null>
  signOut: () => void
}

/** The secure-store key the signed-in account is kept under. */
const ACCOUNT_SESSION_KEY = 'raven.account'

const isStoredSession = (value: unknown): value is { session: AccountSession | null } =>
  typeof value === 'object' &&
  value !== null &&
  'session' in value &&
  (value.session === null || isAccountSession(value.session))

/** One refresh at a time: calls that arrive while it runs share its answer. */
let running: Promise<string | null> | null = null

/** Who is signed in on this device, kept in the secure store; it hydrates only when asked. */
export const useAccountSession = create<AccountSessionState>()(
  persist(
    (set, get) => ({
      session: null,
      signIn: async ({ email, password }) => {
        const outcome = await signInWithPassword({
          origin: RAVEN_SERVER.origin,
          email,
          password,
        })
        if (outcome.kind === AUTH_OUTCOMES.ok) set({ session: outcome.session })
        return outcome
      },
      refresh: () => {
        running ??= (async () => {
          const { session } = get()
          if (session === null) return null
          const outcome = await refreshSession({ origin: RAVEN_SERVER.origin, session })
          if (outcome.kind === AUTH_OUTCOMES.ok) {
            set({ session: outcome.session })
            return outcome.session.accessToken
          }
          if (outcome.kind === AUTH_OUTCOMES.refused) set({ session: null })
          return null
        })().finally(() => {
          running = null
        })
        return running
      },
      signOut: () => set({ session: null }),
    }),
    {
      name: ACCOUNT_SESSION_KEY,
      storage: createJSONStorage(() => secretStateStorage({ store: secretStore })),
      skipHydration: true,
      partialize: ({ session }) => ({ session }),
      merge: (stored, current) => {
        const session = (isStoredSession(stored) ? stored.session : null) ?? null
        return { ...current, session }
      },
    },
  ),
)

/** The signed-in account's access token, null when nobody is signed in. */
export const accessTokenNow = (): string | null =>
  useAccountSession.getState().session?.accessToken ?? null

/** The signed-in account's access token as a hook, so what is drawn with it follows a refresh. */
export const useAccessToken = (): string | null =>
  useAccountSession((state) => state.session?.accessToken ?? null)
