import { type ApiClient, type RemoteAccessChange } from '@raven/core'
import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '@/query/queryClient'

type UseServerRemoteAccessProps = { api: ApiClient }

/**
 * Remote Access on one server, for the owner: the settings, the addresses and
 * what the outside check found, and the save, which checks again and puts
 * the server's answer in the cache.
 */
export const useServerRemoteAccess = ({ api }: UseServerRemoteAccessProps) => {
  const queryClient = useQueryClient()
  const query = queryOptions({
    queryKey: queryKeys.remoteAccess,
    queryFn: () => api.getRemoteAccess(),
  })
  const state = useQuery(query)
  const save = useMutation({
    mutationFn: (change: RemoteAccessChange) => api.setRemoteAccess(change),
    onSuccess: (next) => queryClient.setQueryData(query.queryKey, next),
  })
  return { state, save }
}
