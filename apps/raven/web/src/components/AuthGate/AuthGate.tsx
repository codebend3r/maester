import { useIsFetching, useQueryClient } from '@tanstack/react-query'
import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { Button } from '@raven/ui'
import { AUTH_ROUTES } from '@raven/core'
import { ACCESS_KINDS, useAccessState } from '@/lib/accessState'
import { signInPath } from '@/lib/authRoutes'
import { queryKeys } from '@/lib/queryClient'
import styles from '@/components/AuthGate/AuthGate.module.scss'

const Loading = () => (
  <main className={styles.screen}>
    <output className={styles.copy}>Checking your account</output>
  </main>
)

const Failed = () => {
  const queryClient = useQueryClient()
  const isRetrying = useIsFetching({ queryKey: queryKeys.auth }) > 0
  return (
    <main className={styles.screen}>
      <section className={styles.panel}>
        <h1 className={styles.title}>Account access is temporarily unavailable</h1>
        <p className={styles.copy}>raven could not check your account. Your session is kept.</p>
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
 * The route element in front of every page that needs a signed-in, approved
 * account. With accounts off, or not reachable yet, it lets everything
 * through as raven always has. A failure to reach the server shows a screen
 * to try again from, and never signs anyone out.
 */
export const AuthGate = () => {
  const access = useAccessState()
  const { pathname, search } = useLocation()
  switch (access.kind) {
    case ACCESS_KINDS.disabled:
    case ACCESS_KINDS.unavailable:
    case ACCESS_KINDS.approved:
      return <Outlet />
    case ACCESS_KINDS.loading:
      return <Loading />
    case ACCESS_KINDS.failed:
      return <Failed />
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
