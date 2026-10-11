import type { RoutePending } from '@/lib/routeQuery'
import { NotFoundPage } from '@/pages/NotFoundPage/NotFoundPage'
import styles from '@/components/RouteState/RouteState.module.scss'

/** What a page shows while what its address names is missing, failing or on its way. */
export const RouteState = ({ state, noun }: { state: RoutePending; noun: string }) => {
  switch (state.state) {
    case 'missing':
      return <NotFoundPage />
    case 'error':
      return (
        <p className={styles.message} role="alert">
          {state.message}
        </p>
      )
    case 'loading':
      return <p className={styles.message}>Opening the {noun}</p>
    default: {
      const unknown: never = state
      return unknown
    }
  }
}
