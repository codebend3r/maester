import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { BingeState } from '@raven/core'
import { api } from '@/lib/api'
import { bingeStateQuery } from '@/lib/bingeState'
import { useAuthSession } from '@/stores/authSession'

const LOCAL_VIEWER = 'local'
const EMPTY_IDS: readonly number[] = []

/**
 * The signed-in account's binge shows, from the server so every device sees
 * the same list. Until it answers the tip counts as seen, so it never flashes.
 */
export const useBingeProfile = () => {
  const account = useAuthSession((state) => state.session?.userId ?? LOCAL_VIEWER)
  const { data, isPending } = useQuery(bingeStateQuery({ account }))
  return {
    ids: data?.ids ?? EMPTY_IDS,
    hasSeenTip: data?.hasSeenTip ?? true,
    isPending,
    account,
  }
}

type SetBingeVariables = { id: number; binge: boolean }

/** Adds a show to the binge list or removes it; the list refreshes from the server either way. */
export const useSetBinge = () => {
  const client = useQueryClient()
  const { account } = useBingeProfile()
  const { queryKey } = bingeStateQuery({ account })
  return useMutation({
    mutationFn: ({ id, binge }: SetBingeVariables) => api.setBinge({ id, binge }),
    onSuccess: (state: BingeState) => client.setQueryData(queryKey, state),
    onError: () => client.invalidateQueries({ queryKey }),
  })
}

/** Records that the account has seen the binge tip. */
export const useDismissBingeTip = () => {
  const client = useQueryClient()
  const { account } = useBingeProfile()
  const { queryKey } = bingeStateQuery({ account })
  return useMutation({
    mutationFn: () => api.dismissBingeTip(),
    onSuccess: (state: BingeState) => client.setQueryData(queryKey, state),
  })
}
