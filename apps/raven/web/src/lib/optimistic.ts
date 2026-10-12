import type { MutationKey, QueryClient, QueryFilters, QueryKey } from '@tanstack/react-query'
import { isRecord } from '@raven/core'

/** What an optimistic change replaced in the cache, to put back if the server refuses it. */
export type Snapshot = ReadonlyArray<readonly [QueryKey, unknown]>

/** A change to some cached data; it hands back the very same data where it changes nothing. */
export type Patch = (data: unknown) => unknown

/**
 * Shows a change before the server answers: every cached query `filters`
 * find whose data `patch` changes takes the patched data at once, with any
 * fetch of it in flight called off so an older answer cannot land over it.
 * Queries `patch` leaves alone are not touched, not even marked fresh.
 */
export const patchQueries = async ({
  queryClient,
  filters,
  patch,
}: {
  queryClient: QueryClient
  filters: readonly QueryFilters[]
  patch: Patch
}): Promise<Snapshot> => {
  const found = new Map(
    filters
      .flatMap((filter) => queryClient.getQueryCache().findAll(filter))
      .map((query) => [query.queryHash, query]),
  )
  const changing = [...found.values()].filter(
    (query) => patch(query.state.data) !== query.state.data,
  )
  await Promise.all(
    changing.map((query) => queryClient.cancelQueries({ queryKey: query.queryKey, exact: true })),
  )
  return changing.map((query) => {
    const before = query.state.data
    queryClient.setQueryData(query.queryKey, patch(before))
    return [query.queryKey, before] as const
  })
}

/**
 * `patch` for every record `guard` accepts with the id `id`, however deep
 * in some cached data it sits: a listing, a poster entry, a history day,
 * an item's versions. Data holding none comes back as it was.
 */
export const patchEvery = <T extends { id: number }>({
  guard,
  id,
  patch,
}: {
  guard: (value: unknown) => value is T
  id: number
  patch: (value: T) => T
}): Patch => {
  const walk: Patch = (data) => {
    if (Array.isArray(data)) {
      const list: readonly unknown[] = data
      const next = list.map(walk)
      return next.every((value, index) => value === list[index]) ? data : next
    }
    if (!isRecord(data)) return data
    if (data.id === id && guard(data)) return patch(data)
    const entries = Object.entries(data)
    const next = entries.map(([key, value]) => [key, walk(value)] as const)
    return next.every(([, value], index) => value === entries[index]?.[1])
      ? data
      : Object.fromEntries(next)
  }
  return walk
}

/**
 * The options every optimistic change shares, spread into `useMutation`:
 * `apply` shows the change at once and a refusal puts the cache back. Only
 * once the last of several changes to the same thing has settled is the
 * server asked again, through `settle`, for what they all came to; an
 * answer to any one of them, which may come back out of order, is never
 * written over the cache.
 */
export const optimisticChange = <TVariables>({
  queryClient,
  mutationKey,
  apply,
  settle,
}: {
  queryClient: QueryClient
  mutationKey: MutationKey
  apply: (variables: TVariables) => Promise<Snapshot>
  /** Reads again what the change touched. */
  settle: () => Promise<unknown>
}) => {
  // The mutation asking is still counted while its own callbacks run.
  const isLast = (): boolean => queryClient.isMutating({ mutationKey }) <= 1
  return {
    mutationKey,
    onMutate: apply,
    // Latest first, so a query two patches touched ends as it began.
    onError: (_error: Error, _variables: TVariables, snapshot: Snapshot | undefined) => {
      if (!snapshot || !isLast()) return
      snapshot.toReversed().forEach(([queryKey, data]) => queryClient.setQueryData(queryKey, data))
    },
    onSettled: () => (isLast() ? settle() : undefined),
  }
}
