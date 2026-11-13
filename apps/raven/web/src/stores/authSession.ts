import type { Session } from '@supabase/supabase-js'
import { create } from 'zustand'
import { createJSONStorage, devtools, persist } from 'zustand/middleware'
import { STORE_KEYS } from '@/stores/storage'
import {
  type AuthClient,
  type ReadyAuthConfig,
  AUTH_EVENTS,
  createAuthClient,
  hasSessionCookie,
} from '@/lib/authClient'
import { clearAccountState } from '@/lib/clearAccountState'
import { queryKeys } from '@raven/ui/headless'
import { queryClient } from '@/lib/queryClient'
import { handled } from '@/lib/handled'

export const AUTH_SESSION_STATUSES = { booting: 'booting', ready: 'ready' } as const
export type AuthSessionStatus = (typeof AUTH_SESSION_STATUSES)[keyof typeof AUTH_SESSION_STATUSES]

/** The two things the app reads off a Supabase session, so no refresh token reaches a component. */
export type SessionSummary = { accessToken: string; userId: string }

type CreateClient = (input: Parameters<typeof createAuthClient>[0]) => Promise<AuthClient>

type StartProps = {
  config: ReadyAuthConfig
  createClient?: CreateClient
  /** `document.cookie` and the address's query and hash, read when the session starts. */
  page?: { cookies: string; search: string; hash: string }
}

export type AuthSessionState = {
  client: AuthClient | null
  session: SessionSummary | null
  status: AuthSessionStatus
  /**
   * Whether the session came from a recovery link opened in this tab. Supabase
   * announces that once, as `PASSWORD_RECOVERY`, so a reload forgets it and the
   * visitor asks for a new link.
   */
  isRecovery: boolean
  /** Whether `start` has run, which it does once, while the client may still be loading. */
  hasStarted: boolean
  endRecovery: () => void
  /** Builds the client once, reads the stored session and follows every change to it. */
  start: (options: StartProps) => void
}

const PAGE_READY = { complete: 'complete' } as const
const PAGE_EVENTS = { load: 'load' } as const

/** The longest the client waits for an idle moment once the page has loaded. */
const IDLE_TIMEOUT_MS = 2000

/** Runs `then` at the first idle moment after the page and what it loaded have finished. */
const afterPageLoad = (then: () => void): void => {
  const whenIdle = () => {
    if (!('requestIdleCallback' in window)) return void setTimeout(then, 0)
    window.requestIdleCallback(then, { timeout: IDLE_TIMEOUT_MS })
  }
  if (document.readyState === PAGE_READY.complete) return whenIdle()
  window.addEventListener(PAGE_EVENTS.load, whenIdle, { once: true })
}

const browserPage = () => ({
  cookies: document.cookie,
  search: window.location.search,
  hash: window.location.hash,
})

type IsSurelySignedOutProps = { config: ReadyAuthConfig; page: NonNullable<StartProps['page']> }

/**
 * No session cookie, and no sign-in link's code or token in the address for Supabase to turn into
 * one: nobody is signed in, so the sign-in page need not wait for Supabase's code to say so.
 */
const isSurelySignedOut = ({ config, page }: IsSurelySignedOutProps): boolean =>
  page.search === '' &&
  page.hash === '' &&
  !hasSessionCookie({ cookies: page.cookies, cookieName: config.cookieName })

const summaryOf = (session: Session | null): SessionSummary | null =>
  session === null ? null : { accessToken: session.access_token, userId: session.user.id }

type FollowAccountProps = {
  previous: SessionSummary | null
  next: SessionSummary | null
}

/**
 * What the previous account left behind is dropped whenever the account
 * changes, a sign out in another tab or an expired session included. A first
 * sign in after nobody was signed in keeps the cache but marks it stale: the
 * server refused what was asked for before, and the account query is keyed by
 * user, so nothing of another account can show. It runs inside Supabase's
 * auth listener, which must not wait on anything, so a refetch that fails is
 * left to the queries that show it.
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
export const useAuthSession = create<AuthSessionState>()(
  devtools(
    persist(
      (set, get) => ({
        client: null,
        session: null,
        status: AUTH_SESSION_STATUSES.booting,
        isRecovery: false,
        hasStarted: false,
        endRecovery: () => set({ isRecovery: false }),
        start: ({ config, createClient = createAuthClient, page = browserPage() }) => {
          if (get().hasStarted) return
          set({ hasStarted: true })
          // A store emptied while Supabase's code loads (a sign out's reset, a test's) has moved on.
          const settle = (session: Session | null) => {
            if (!get().hasStarted) return
            set({ session: summaryOf(session), status: AUTH_SESSION_STATUSES.ready })
          }
          const isSignedOut = isSurelySignedOut({ config, page })
          if (isSignedOut) settle(null)
          const follow = (client: AuthClient) => {
            if (!get().hasStarted) return
            set({ client })
            client.onAuthStateChange((event, session) => {
              const previous = get().session
              const next = summaryOf(session)
              set({
                session: next,
                isRecovery:
                  next !== null &&
                  (event === AUTH_EVENTS.passwordRecovery ||
                    (get().isRecovery && (previous?.userId ?? null) === next.userId)),
              })
              followAccount({ previous, next })
            })
            client.getSession().then(
              ({ data }) => settle(data.session),
              () => settle(null),
            )
          }
          // Supabase's code failing to load leaves nobody signed in, as a session that fails to read does.
          const build = () => {
            handled(createClient({ config }).then(follow, () => settle(null)))
          }
          /*
           * Signed out, the sign-in page draws first and its form waits for the client, so the client
           * loads once the page has, not beside the page's own code.
           */
          if (isSignedOut) return afterPageLoad(build)
          build()
        },
      }),
      {
        name: STORE_KEYS.authSession,
        storage: createJSONStorage(() => window.localStorage),
        partialize: ({ session }) => ({ session }),
      },
    ),
    { name: 'raven/authSession' },
  ),
)

/** Calls `listener` with the session's access token each time it changes, null on sign out; returns the unsubscribe. */
export const onAccessTokenChange = (listener: (token: string | null) => void): (() => void) =>
  useAuthSession.subscribe((state, previous) => {
    const token = state.session?.accessToken ?? null
    if (token !== (previous.session?.accessToken ?? null)) listener(token)
  })
