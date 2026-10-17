import { useQuery } from '@tanstack/react-query'
import { ApiError, type ItemDetails, type ItemType, isLockedError } from '@raven/core'
import { useParams } from 'react-router-dom'
import { itemQuery } from '@/lib/queries'

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

/** A whole-number route param, or null when the address carries something else. */
export const useRouteId = (param = 'id'): number | null => {
  const value = Number(useParams()[param])
  return Number.isInteger(value) ? value : null
}

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

/** The item `/<type>s/:id` names; another type of item at that id is not there. */
export const useRouteItem = (type: ItemType): RouteQuery<ItemDetails> => {
  const id = useRouteId()
  const page = routeState({ id, query: useQuery(itemQuery(id)) })
  return page.state === ROUTE_STATES.ready && page.data.type !== type
    ? { state: ROUTE_STATES.missing }
    : page
}
