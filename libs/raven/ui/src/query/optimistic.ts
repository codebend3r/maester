import {
  type DataTag,
  type MutationKey,
  type QueryClient,
  type QueryFilters,
  type QueryKey,
  hashKey,
  useMutation,
  useQueryClient,
} from '@tanstack/react-query'
import { useState } from 'react'

/** A write an edit would make: to the query `queryKey` names, whose data it changes. */
type Write = { queryKey: QueryKey; write: () => void }

/**
 * One change to the cache. It plans a write only for each query whose data
 * it would change, so a query it leaves as it was is not touched: no fetch
 * called off, nothing marked fresh.
 */
export type Edit = { plan: (queryClient: QueryClient) => Write[] }

/** What the edits of a change replaced, to put back if the server refuses it. */
type Snapshot = ReadonlyArray<readonly [QueryKey, unknown]>

type EditAllProps<T> = {
  filters: QueryFilters
  update: (data: T) => T
}

/**
 * An edit to every query `filters` find, each holding a `T`, as every
 * listing of a library does. `update` hands back the very same data where
 * it changes nothing.
 */
export const editAll = <T>({ filters, update }: EditAllProps<T>): Edit => ({
  plan: (queryClient) =>
    queryClient
      .getQueriesData<T>(filters)
      .filter(([, data]) => data !== undefined && update(data) !== data)
      .map(([queryKey]) => ({
        queryKey,
        write: () =>
          queryClient.setQueryData<T>(queryKey, (data) =>
            data === undefined ? data : update(data),
          ),
      })),
})

type EditProps<T> = {
  queryKey: DataTag<QueryKey, T, Error>
  update: (data: T) => T
}

/** An edit to the one query `queryKey` names, its data typed as that query's. */
export const edit = <T>({ queryKey, update }: EditProps<T>): Edit =>
  editAll<T>({ filters: { queryKey, exact: true }, update })

type EditKeyProps<T> = {
  queryKey: QueryKey
  update: (data: NoInfer<T>) => NoInfer<T>
}

/**
 * An edit to the one query a bare key from `queryKeys` names. The key carries
 * no type, so `T` says what the query holds; left out, it is `never` and no
 * `update` fits.
 */
export const editKey = <T = never>({ queryKey, update }: EditKeyProps<T>): Edit =>
  editAll<T>({ filters: { queryKey, exact: true }, update })

type ApplyEditsProps = {
  queryClient: QueryClient
  edits: readonly Edit[]
}

/**
 * Shows a change before the server answers: every query it changes has any
 * fetch in flight called off, so an older answer cannot land over it, then
 * takes the change. What each held before comes back.
 */
const applyEdits = async ({ queryClient, edits }: ApplyEditsProps): Promise<Snapshot> => {
  const planned = () => edits.flatMap((change) => change.plan(queryClient))
  const touched = [
    ...new Map(planned().map(({ queryKey }) => [hashKey(queryKey), queryKey])).values(),
  ]
  await Promise.all(touched.map((queryKey) => queryClient.cancelQueries({ queryKey, exact: true })))
  const snapshot = touched.map(
    (queryKey) => [queryKey, queryClient.getQueryData(queryKey)] as const,
  )
  // Planned again: a fetch called off has put back what it held before.
  planned().forEach(({ write }) => write())
  return snapshot
}

type UseOptimisticMutationProps<TVariables> = {
  mutationKey: MutationKey
  mutationFn: (variables: TVariables) => Promise<unknown>
  edits: (variables: TVariables) => readonly Edit[]
  settle: () => Promise<unknown>
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
}: UseOptimisticMutationProps<TVariables>) => {
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
    /** As `mutate`, for a caller that waits on the answer: it rejects with why the server refused. */
    mutateAsync: (variables: TVariables) => {
      setFailure(null)
      return mutation.mutateAsync(variables)
    },
    isPending: mutation.isPending,
    failure,
  }
}
