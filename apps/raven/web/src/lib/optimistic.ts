import {
  type MutationKey,
  type QueryClient,
  type QueryFilters,
  type QueryKey,
  hashKey,
  useMutation,
  useQueryClient,
} from '@tanstack/react-query'
import { useState } from 'react'

/** One change to the cache, ready to write into each query its filters find. */
export type Edit = {
  filters: QueryFilters
  write: (args: { queryClient: QueryClient; queryKey: QueryKey }) => void
}

/** What the edits of a change replaced, to put back if the server refuses it. */
type Snapshot = ReadonlyArray<readonly [QueryKey, unknown]>

/** An edit to every query `filters` find, each holding a `T`, put through `update`. */
export const edit = <T>({
  filters,
  update,
}: {
  filters: QueryFilters
  update: (data: T) => T
}): Edit => ({
  filters,
  write: ({ queryClient, queryKey }) =>
    queryClient.setQueryData<T>(queryKey, (data) => (data === undefined ? data : update(data))),
})

/**
 * Shows a change before the server answers: every query the edits touch
 * has any fetch in flight called off, so an older answer cannot land over
 * the change, then takes its edits. What each held before comes back.
 */
const applyEdits = async ({
  queryClient,
  edits,
}: {
  queryClient: QueryClient
  edits: readonly Edit[]
}): Promise<Snapshot> => {
  const touched = edits.map((change) => ({
    change,
    queries: queryClient.getQueryCache().findAll(change.filters),
  }))
  const queries = [
    ...new Map(
      touched.flatMap((entry) => entry.queries).map((query) => [query.queryHash, query]),
    ).values(),
  ]
  await Promise.all(
    queries.map((query) => queryClient.cancelQueries({ queryKey: query.queryKey, exact: true })),
  )
  const snapshot = queries.map((query) => [query.queryKey, query.state.data] as const)
  touched.forEach(({ change, queries: found }) =>
    found.forEach((query) => change.write({ queryClient, queryKey: query.queryKey })),
  )
  return snapshot
}

/**
 * A change shown before the server answers: `edits` patch the cache at
 * once, and a refusal puts it back. Changes with the same key go to the
 * server one at a time, in the order they were made, so their answers
 * cannot cross; once the last of them settles, `settle` reads again what
 * they touched. `failure` is why the server refused one, until the next
 * change is made.
 */
export const useOptimisticMutation = <TVariables>({
  mutationKey,
  mutationFn,
  edits,
  settle,
}: {
  mutationKey: MutationKey
  mutationFn: (variables: TVariables) => Promise<unknown>
  edits: (variables: TVariables) => readonly Edit[]
  settle: () => Promise<unknown>
}) => {
  const queryClient = useQueryClient()
  const [failure, setFailure] = useState<Error | null>(null)
  // The change asking is still counted while its own callbacks run, and a
  // change waiting its turn counts too.
  const isLast = (): boolean => queryClient.isMutating({ mutationKey }) <= 1
  const mutation = useMutation({
    mutationKey,
    scope: { id: hashKey(mutationKey) },
    mutationFn,
    onMutate: (variables: TVariables) => applyEdits({ queryClient, edits: edits(variables) }),
    // A change still waiting its turn was made over this one, so only the
    // last puts the cache back; the reading again after it settles the rest.
    onError: (error, _variables, snapshot) => {
      setFailure(error)
      if (!snapshot || !isLast()) return
      snapshot.forEach(([queryKey, data]) => queryClient.setQueryData(queryKey, data))
    },
    onSettled: () => (isLast() ? settle() : undefined),
  })
  return {
    mutate: (variables: TVariables) => {
      setFailure(null)
      mutation.mutate(variables)
    },
    isPending: mutation.isPending,
    failure,
  }
}
