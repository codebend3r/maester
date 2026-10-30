import { ROUTE_STATES, type RouteQuery } from '@raven/core'

import { ItemNotice } from '@/layouts'

/** What a page says while it has nothing of its own to show. */
type RouteNoticeCopy = { opening: string; missing: string }

/** What each view of a page that reads one thing from its address is handed. */
export type RouteViewProps<T> = {
  page: RouteQuery<T>
  copy: RouteNoticeCopy
  onBack: () => void
}

type RouteMissingProps = RouteViewProps<unknown>

/** The address names nothing the server has. */
export const RouteMissing = ({ copy, onBack }: RouteMissingProps) => (
  <ItemNotice notice={copy.missing} onBack={onBack} />
)

type RouteErrorProps = RouteViewProps<unknown>

/** The server could not say, in its own words. */
export const RouteError = ({ page, onBack }: RouteErrorProps) =>
  page.state === ROUTE_STATES.error && <ItemNotice notice={page.message} onBack={onBack} />

type RouteLoadingProps = RouteViewProps<unknown>

/** The page is on its way. */
export const RouteLoading = ({ copy, onBack }: RouteLoadingProps) => (
  <ItemNotice notice={copy.opening} onBack={onBack} />
)
