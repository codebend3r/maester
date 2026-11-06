import { type ApiClient, activeWorkOf } from '@raven/core'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { RavenQueries } from '@/query/ravenQueries'

/** How often the libraries are read again while the scans show, so their progress moves. */
const SCANS_POLL_MS = 2000

type UseServerActiveWorkProps = {
  api: ApiClient
  librariesQuery: RavenQueries['librariesQuery']
}

/**
 * Admin's Library scans on one server: the libraries, read again every two seconds, the work
 * running across them (each by its kind, for the host to name), and the one press that stops
 * it all. `error` is the read's or the cancel's.
 */
export const useServerActiveWork = ({ api, librariesQuery }: UseServerActiveWorkProps) => {
  const queryClient = useQueryClient()
  const state = useQuery({ ...librariesQuery, refetchInterval: SCANS_POLL_MS })
  const libraries = state.data ?? []
  const cancel = useMutation({
    mutationFn: async () => {
      await Promise.all(activeWorkOf({ api, libraries }).map((work) => work.cancel()))
    },
    onSettled: () =>
      queryClient.invalidateQueries({ queryKey: librariesQuery.queryKey, exact: true }),
  })
  return {
    state,
    running: activeWorkOf({ api, libraries }),
    cancel,
    error: state.error ?? cancel.error,
  }
}
