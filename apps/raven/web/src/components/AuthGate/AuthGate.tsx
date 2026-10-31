import { useIsFetching, useQueryClient } from '@tanstack/react-query'
import type { ComponentType } from 'react'
import { Navigate, Outlet, parsePath, useLocation } from 'react-router-dom'
import { Button } from '@raven/ui'
import { AUTH_ROUTES } from '@raven/core'
import { downloadsPageFor, isFilePlaying, isOfflinePage, offlineReturnOf } from '@/desktop/paths'
import { ACCESS_KINDS, type AccessState, useAccessState } from '@/lib/accessState'
import { signInPath } from '@/lib/authRoutes'
import { queryKeys } from '@raven/ui/headless'
import { AUTH_GATE_COPY } from '@/components/AuthGate/copy'
import { RavenLoader } from '@/components/RavenLoader/RavenLoader'
import { useServerReach } from '@/stores/serverReach'
import styles from '@/components/AuthGate/AuthGate.module.scss'

const Loading = () => <RavenLoader isFullscreen shouldShowLabel={false} />

type RetryProps = { title: string; message: string }

const Retry = ({ title, message }: RetryProps) => {
  const queryClient = useQueryClient()
  const isRetrying = useIsFetching({ queryKey: queryKeys.auth }) > 0
  return (
    <main className={styles.screen}>
      <section className={styles.panel}>
        <h1 className={styles.title}>{title}</h1>
        <p className={styles.copy}>{message}</p>
        <Button
          tone="primary"
          disabled={isRetrying}
          onClick={() => queryClient.refetchQueries({ queryKey: queryKeys.auth })}
        >
          {AUTH_GATE_COPY.tryAgain}
        </Button>
      </section>
    </main>
  )
}

/**
 * The states that say nothing yet of whether the account may play: it is being read, or could not
 * be. A file playing needs no account, so a server coming back never stops it for one of these.
 */
const UNSETTLED: ReadonlySet<AccessState['kind']> = new Set([
  ACCESS_KINDS.loading,
  ACCESS_KINDS.failed,
  ACCESS_KINDS.unavailable,
])

/** What the gate puts on screen in place of, or as, the page asked for. */
const GATE_VIEWS = {
  page: 'page',
  offline: 'offline',
  loading: 'loading',
  failed: 'failed',
  unavailable: 'unavailable',
  signIn: 'signIn',
  pending: 'pending',
} as const
type GateView = (typeof GATE_VIEWS)[keyof typeof GATE_VIEWS]

/** The view each account state shows, once the server is in reach and no file is playing. */
const ACCESS_VIEWS = {
  [ACCESS_KINDS.disabled]: GATE_VIEWS.page,
  [ACCESS_KINDS.approved]: GATE_VIEWS.page,
  [ACCESS_KINDS.loading]: GATE_VIEWS.loading,
  [ACCESS_KINDS.failed]: GATE_VIEWS.failed,
  [ACCESS_KINDS.unavailable]: GATE_VIEWS.unavailable,
  [ACCESS_KINDS.signedOut]: GATE_VIEWS.signIn,
  [ACCESS_KINDS.pending]: GATE_VIEWS.pending,
  [ACCESS_KINDS.revoked]: GATE_VIEWS.pending,
} as const satisfies Record<AccessState['kind'], GateView>

type GateViewOfProps = { access: AccessState; isOffline: boolean; pathname: string }

const gateViewOf = ({ access, isOffline, pathname }: GateViewOfProps): GateView => {
  if (isOffline) return isOfflinePage(pathname) ? GATE_VIEWS.page : GATE_VIEWS.offline
  if (UNSETTLED.has(access.kind) && isFilePlaying(pathname)) return GATE_VIEWS.page
  return ACCESS_VIEWS[access.kind]
}

/** The address asked for, which a redirect hands on to come back to. */
type GateViewProps = { returnTo: string }

const Page = () => <Outlet />

type OfflineRedirectProps = GateViewProps

/** To the Downloads of the mode the page asked for was in, which comes back to it once the server answers. */
const OfflineRedirect = ({ returnTo }: OfflineRedirectProps) => (
  <Navigate
    replace
    to={downloadsPageFor(parsePath(returnTo).pathname ?? '')}
    state={offlineReturnOf(returnTo)}
  />
)

const FailedRetry = () => (
  <Retry title={AUTH_GATE_COPY.failedTitle} message={AUTH_GATE_COPY.failedMessage} />
)

const UnavailableRetry = () => (
  <Retry title={AUTH_GATE_COPY.unavailableTitle} message={AUTH_GATE_COPY.unavailableMessage} />
)

type SignInRedirectProps = GateViewProps

const SignInRedirect = ({ returnTo }: SignInRedirectProps) => (
  <Navigate replace to={signInPath({ returnTo })} />
)

const PendingRedirect = () => <Navigate replace to={AUTH_ROUTES.pending} />

const GATE_SCREENS = {
  [GATE_VIEWS.page]: Page,
  [GATE_VIEWS.offline]: OfflineRedirect,
  [GATE_VIEWS.loading]: Loading,
  [GATE_VIEWS.failed]: FailedRetry,
  [GATE_VIEWS.unavailable]: UnavailableRetry,
  [GATE_VIEWS.signIn]: SignInRedirect,
  [GATE_VIEWS.pending]: PendingRedirect,
} as const satisfies Record<GateView, ComponentType<GateViewProps>>

/**
 * The route element in front of every page that needs a signed-in, approved
 * account. With accounts off it lets everything through as raven always
 * has. Accounts that cannot be reached, like a failure to reach the server,
 * show a screen to try again from, and never sign anyone out. Inside raven
 * player, a server out of reach opens the pages that need none instead
 * (Downloads, On this Mac and Settings), and any other page goes to
 * Downloads, which goes back to it once the server answers again. A local file or download
 * playing stays on screen while the account is read, or cannot be.
 */
export const AuthGate = () => {
  const access = useAccessState()
  const isOffline = useServerReach((state) => state.isOffline)
  const { pathname, search } = useLocation()
  const Screen = GATE_SCREENS[gateViewOf({ access, isOffline, pathname })]
  return <Screen returnTo={`${pathname}${search}`} />
}
