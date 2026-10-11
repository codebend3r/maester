import { useQuery } from '@tanstack/react-query'
import { ApiError, type ItemDetails, type ItemType } from '@raven/core'
import { useParams } from 'react-router-dom'
import { itemQuery } from '@/lib/queries'

/** Where a page reading one thing from its address stands. */
export type RouteQuery<T> =
  | { state: 'missing' }
  | { state: 'error'; message: string }
  | { state: 'loading' }
  | { state: 'ready'; data: T }

/** Every state but ready: what a page shows instead of itself. */
export type RoutePending = Exclude<RouteQuery<never>, { state: 'ready' }>

/** What `routeState` reads of a query; a `useQuery` result is one. */
type QueryView<T> = { data: T | undefined; error: Error | null }

/** A whole-number route param, or null when the address carries something else. */
export const useRouteId = (param = 'id'): number | null => {
  const value = Number(useParams()[param])
  return Number.isInteger(value) ? value : null
}

/**
 * A query for what the address names, as one of four states: nothing there
 * (no id, or a 404), a failure, on its way, or ready.
 */
export const routeState = <T>({
  id,
  query,
}: {
  id: number | null
  query: QueryView<T>
}): RouteQuery<T> => {
  if (id == null) return { state: 'missing' }
  if (query.error instanceof ApiError && query.error.status === 404) return { state: 'missing' }
  if (query.error) return { state: 'error', message: query.error.message }
  if (query.data === undefined) return { state: 'loading' }
  return { state: 'ready', data: query.data }
}

/** The item `/<type>s/:id` names; another type of item at that id is not there. */
export const useRouteItem = (type: ItemType): RouteQuery<ItemDetails> => {
  const id = useRouteId()
  const page = routeState({ id, query: useQuery(itemQuery(id)) })
  return page.state === 'ready' && page.data.type !== type ? { state: 'missing' } : page
}
