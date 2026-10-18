import type { ReactNode } from 'react'
import { Icon } from '@raven/ui'
import { BackButton } from '@/components/BackButton/BackButton'
import { Loading } from '@/components/Skeleton/Skeleton'
import { ROUTE_STATES, type RoutePending } from '@/lib/routeQuery'
import { NotFoundPage } from '@/pages/NotFoundPage/NotFoundPage'
import styles from '@/components/RouteState/RouteState.module.scss'

/**
 * What a page shows while what its address names is missing, failing or on
 * its way; on its way, `shape` stands in for the page in grey. A failure is
 * a panel with the reason in it, under the way back.
 */
export const RouteState = ({
  state,
  noun,
  shape,
}: {
  state: RoutePending
  noun: string
  shape: ReactNode
}) => {
  switch (state.state) {
    case ROUTE_STATES.missing:
      return <NotFoundPage />
    case ROUTE_STATES.error:
      return (
        <div className={styles.failed}>
          <BackButton fallback={null} />
          <p className={styles.message} role="alert">
            <Icon name="alert" />
            <span className={styles.reason}>{state.message}</span>
          </p>
        </div>
      )
    case ROUTE_STATES.loading:
      return <Loading label={`Opening the ${noun}`}>{shape}</Loading>
    default: {
      const unknown: never = state
      return unknown
    }
  }
}
