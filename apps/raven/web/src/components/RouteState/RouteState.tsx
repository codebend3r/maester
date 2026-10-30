import { ROUTE_STATES, type RoutePending } from '@raven/core'
import type { ComponentType, ReactNode } from 'react'
import { Icon } from '@raven/ui'
import { BackButton } from '@/components/BackButton/BackButton'
import { ROUTE_STATE_COPY } from '@/components/RouteState/copy'
import { Loading } from '@/components/Skeleton/Skeleton'
import { NotFoundPage } from '@/pages/NotFoundPage/NotFoundPage'
import styles from '@/components/RouteState/RouteState.module.scss'

type RouteStateProps = {
  state: RoutePending
  noun: string
  shape: ReactNode
}

type RouteFailedProps = RouteStateProps

const RouteFailed = ({ state }: RouteFailedProps) => (
  <div className={styles.failed}>
    <BackButton fallback={null} />
    <p className={styles.message} role="alert">
      <Icon name="alert" />
      <span className={styles.reason}>
        {state.state === ROUTE_STATES.error ? state.message : ''}
      </span>
    </p>
  </div>
)

type RouteLoadingProps = RouteStateProps

const RouteLoading = ({ noun, shape }: RouteLoadingProps) => (
  <Loading label={ROUTE_STATE_COPY.opening(noun)}>{shape}</Loading>
)

const ROUTE_VIEWS = {
  [ROUTE_STATES.missing]: NotFoundPage,
  [ROUTE_STATES.error]: RouteFailed,
  [ROUTE_STATES.loading]: RouteLoading,
} as const satisfies Record<RoutePending['state'], ComponentType<RouteStateProps>>

/**
 * What a page shows while what its address names is missing, failing or on
 * its way; on its way, `shape` stands in for the page in grey. A failure is
 * a panel with the reason in it, under the way back.
 */
export const RouteState = (props: RouteStateProps) => {
  const View: ComponentType<RouteStateProps> = ROUTE_VIEWS[props.state.state]
  return <View {...props} />
}
