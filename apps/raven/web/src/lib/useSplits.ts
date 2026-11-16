import type { Duplicates, SplitHow } from '@raven/core'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { afterSplit, queryKeys } from '@raven/ui/headless'
import { api } from '@/lib/api'

type UseSplitsProps = { libraryId: number }

type SplitProps = { mediaId: number; how: SplitHow }

/**
 * Split apart and Put back together for a library's movies. The server answers either with the
 * library's duplicates as they now stand, which their query keeps, and everything that lists the
 * movie's cards reads again.
 */
export const useSplits = ({ libraryId }: UseSplitsProps) => {
  const queryClient = useQueryClient()
  const onSuccess = (updated: Duplicates) => {
    queryClient.setQueryData(queryKeys.duplicates(libraryId), updated)
    return afterSplit({ queryClient, libraryId })
  }
  const split = useMutation({
    mutationFn: ({ mediaId, how }: SplitProps) => api.splitDuplicate({ libraryId, mediaId, how }),
    onSuccess,
  })
  const join = useMutation({
    mutationFn: (itemId: number) => api.joinSplit({ libraryId, itemId }),
    onSuccess,
  })
  return {
    split,
    join,
    isBusy: split.isPending || join.isPending,
    failure: split.error ?? join.error,
  }
}
