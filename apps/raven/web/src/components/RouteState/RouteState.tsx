import type { ReactNode } from 'react'
import { Loading } from '@/components/Skeleton/Skeleton'
import type { RoutePending } from '@/lib/routeQuery'
import { NotFoundPage } from '@/pages/NotFoundPage/NotFoundPage'
import styles from '@/components/RouteState/RouteState.module.scss'

/**
 * What a page shows while what its address names is missing, failing or on
 * its way; on its way, `shape` stands in for the page in grey.
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
    case 'missing':
      return <NotFoundPage />
    case 'error':
      return (
        <p className={styles.message} role="alert">
          {state.message}
        </p>
      )
    case 'loading':
      return <Loading label={`Opening the ${noun}`}>{shape}</Loading>
    default: {
      const unknown: never = state
      return unknown
    }
  }
}
