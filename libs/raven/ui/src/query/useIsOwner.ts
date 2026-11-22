import { useQuery } from '@tanstack/react-query'
import type { RavenQueries } from '@/query/ravenQueries'

type UseIsOwnerProps = {
  queries: RavenQueries
  /** The signed-in account's id; null while no one is signed in. */
  userId: string | null
}

/** Whether the signed-in account owns this raven, which `/api/me` says; false until it has answered. */
export const useIsOwner = ({ queries, userId }: UseIsOwnerProps): boolean => {
  const account = useQuery(queries.accountQuery(userId))
  return !!account.data?.isOwner
}
