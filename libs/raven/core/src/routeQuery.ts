import { ApiError, isLockedError } from '@/apiClient'

export const ROUTE_STATES = {
  missing: 'missing',
  error: 'error',
  loading: 'loading',
  ready: 'ready',
} as const

/** Where a page reading one thing from its address stands. */
export type RouteQuery<T> =
  | { state: typeof ROUTE_STATES.missing }
  | { state: typeof ROUTE_STATES.error; message: string }
  | { state: typeof ROUTE_STATES.loading }
  | { state: typeof ROUTE_STATES.ready; data: T }

/** Every state but ready: what a page shows instead of itself. */
export type RoutePending = Exclude<RouteQuery<never>, { state: typeof ROUTE_STATES.ready }>

/** What `routeState` reads of a query; a `useQuery` result is one. */
type QueryView<T> = { data: T | undefined; error: Error | null }

/**
 * A query for what the address names, as one of four states: nothing there
 * (no id, or a 404), a failure, on its way, or ready. A page already read
 * stays up through a failed read behind it, as a poll's, since the next read
 * may well work; only a 404, or a library locked since, takes it down.
 */
export const routeState = <T>({
  id,
  query,
}: {
  id: number | null
  query: QueryView<T>
}): RouteQuery<T> => {
  if (id == null) return { state: ROUTE_STATES.missing }
  if (query.error instanceof ApiError && query.error.status === 404) {
    return { state: ROUTE_STATES.missing }
  }
  if (query.error && (query.data === undefined || isLockedError(query.error))) {
    return { state: ROUTE_STATES.error, message: query.error.message }
  }
  if (query.data === undefined) return { state: ROUTE_STATES.loading }
  return { state: ROUTE_STATES.ready, data: query.data }
}
