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
  const page = routeState({ id, query: useQuery(itemQuery(id)) })
  return page.state === ROUTE_STATES.ready && page.data.type !== type
    ? { state: ROUTE_STATES.missing }
    : page
}
