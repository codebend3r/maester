import { ROUTE_STATES, type RoutePending, type RouteQuery } from '@raven/core'
import type { ComponentType, ReactNode } from 'react'
import { Icon } from '@raven/ui'
import { KeyedView, type ViewOf, type ViewsOf } from '@raven/ui/headless'
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

/** What a page shows while what its address names is missing, failing or on its way. */
const RouteState = (props: RouteStateProps) => {
  const View: ComponentType<RouteStateProps> = ROUTE_VIEWS[props.state.state]
  return <View {...props} />
}

const ROUTE_VIEW_KEYS = { pending: 'pending', ready: 'ready' } as const

type RouteReadyProps = { render: () => ReactNode }

const RouteReady = ({ render }: RouteReadyProps) => render()

type RouteViewsProps = {
  [ROUTE_VIEW_KEYS.pending]: RouteStateProps
  [ROUTE_VIEW_KEYS.ready]: RouteReadyProps
}

const ROUTE_VIEW_VIEWS = {
  [ROUTE_VIEW_KEYS.pending]: RouteState,
  [ROUTE_VIEW_KEYS.ready]: RouteReady,
} as const satisfies ViewsOf<RouteViewsProps>

type RouteViewProps<T> = Omit<RouteStateProps, 'state'> & {
  page: RouteQuery<T>
  /** The page once what its address names is read. */
  children: (data: T) => ReactNode
}

const routeViewOf = <T,>({
  page,
  noun,
  shape,
  children,
}: RouteViewProps<T>): ViewOf<RouteViewsProps> => {
  if (page.state !== ROUTE_STATES.ready)
    return { key: ROUTE_VIEW_KEYS.pending, props: { state: page, noun, shape } }
  const { data } = page
  return { key: ROUTE_VIEW_KEYS.ready, props: { render: () => children(data) } }
}

/**
 * A page that reads one thing from its address: the thing missing, failing
 * or on its way, else the page `children` makes of it. On its way, `shape`
 * stands in for the page in grey; a failure is a panel with the reason in
 * it, under the way back.
 */
export const RouteView = <T,>(props: RouteViewProps<T>) => (
  <KeyedView<RouteViewsProps> views={ROUTE_VIEW_VIEWS} view={routeViewOf(props)} />
)
