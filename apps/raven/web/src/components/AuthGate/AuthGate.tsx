import { useIsFetching, useQueryClient } from '@tanstack/react-query'
import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { Button } from '@raven/ui'
import { AUTH_ROUTES } from '@raven/core'
import { DESKTOP_PATHS, isFilePlaying, isOfflinePage, offlineReturnOf } from '@/desktop/paths'
import { ACCESS_KINDS, type AccessState, useAccessState } from '@/lib/accessState'
import { signInPath } from '@/lib/authRoutes'
import { queryKeys } from '@raven/ui/headless'
import { useServerReach } from '@/stores/serverReach'
import styles from '@/components/AuthGate/AuthGate.module.scss'

const Loading = () => (
  <main className={styles.screen}>
    <output className={styles.copy}>Checking your account</output>
  </main>
)

const Retry = ({ title, message }: { title: string; message: string }) => {
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
          Try again
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
  if (isOffline) {
    if (isOfflinePage(pathname)) return <Outlet />
    return (
      <Navigate
        replace
        to={DESKTOP_PATHS.downloads}
        state={offlineReturnOf(`${pathname}${search}`)}
      />
    )
  }
  if (UNSETTLED.has(access.kind) && isFilePlaying(pathname)) return <Outlet />
  switch (access.kind) {
    case ACCESS_KINDS.disabled:
    case ACCESS_KINDS.approved:
      return <Outlet />
    case ACCESS_KINDS.loading:
      return <Loading />
    case ACCESS_KINDS.failed:
      return (
        <Retry
          title="Account access is temporarily unavailable"
          message="raven could not check your account. Your session is kept."
        />
      )
    case ACCESS_KINDS.unavailable:
      return (
        <Retry
          title="raven is temporarily unavailable"
          message="raven could not reach its accounts. Try again in a moment."
        />
      )
    case ACCESS_KINDS.signedOut:
      return <Navigate replace to={signInPath({ returnTo: `${pathname}${search}` })} />
    case ACCESS_KINDS.pending:
    case ACCESS_KINDS.revoked:
      return <Navigate replace to={AUTH_ROUTES.pending} />
    default: {
      const unreachable: never = access
      return unreachable
    }
  }
}
