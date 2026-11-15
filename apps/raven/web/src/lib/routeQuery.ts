import { useQuery } from '@tanstack/react-query'
import {
  type ItemDetails,
  type ItemType,
  ROUTE_STATES,
  type RouteQuery,
  routeIdOf,
  routeState,
} from '@raven/core'
import { useParams } from 'react-router-dom'
import { itemQuery } from '@/lib/queries'

/** A whole-number route param, or null when the address carries something else. */
export const useRouteId = (param = 'id'): number | null => routeIdOf(useParams()[param])

/** The item `/<type>s/:id` names; another type of item at that id is not there. */
export const useRouteItem = (type: ItemType): RouteQuery<ItemDetails> => {
  const id = useRouteId()
  return pickRoute({
    page: routeState({ id, query: useQuery(itemQuery(id)) }),
    pick: (details) => (details.type === type ? details : null),
  })
}

type PickRouteProps<T, U> = {
  page: RouteQuery<T>
  /** What the page shows of the answer; null when the address names nothing the page shows. */
  pick: (data: T) => U | null
}

/** A read of what the address names, narrowed by `pick`: an answer it finds nothing in is missing. */
export const pickRoute = <T, U>({ page, pick }: PickRouteProps<T, U>): RouteQuery<U> => {
  if (page.state !== ROUTE_STATES.ready) return page
  const picked = pick(page.data)
  if (picked === null) return { state: ROUTE_STATES.missing }
  return { state: ROUTE_STATES.ready, data: picked }
}
