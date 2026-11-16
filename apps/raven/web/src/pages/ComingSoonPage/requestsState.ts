import type { UseQueryResult } from '@tanstack/react-query'

/** What a list of the caller's requests shows: the requests still being read, a failed read, none to list, or the list. */
export const REQUESTS_STATES = {
  reading: 'reading',
  failed: 'failed',
  none: 'none',
  listed: 'listed',
} as const

export type RequestsState = (typeof REQUESTS_STATES)[keyof typeof REQUESTS_STATES]

type RequestsStateOfProps = {
  query: Pick<UseQueryResult, 'isPending' | 'isError'>
  /** How many requests the list holds. */
  count: number
}

export const requestsStateOf = ({ query, count }: RequestsStateOfProps): RequestsState => {
  if (query.isPending) return REQUESTS_STATES.reading
  if (query.isError) return REQUESTS_STATES.failed
  return count === 0 ? REQUESTS_STATES.none : REQUESTS_STATES.listed
}
