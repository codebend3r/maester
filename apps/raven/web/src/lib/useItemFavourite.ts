import { useQueryClient } from '@tanstack/react-query'
import type { ItemDetails } from '@raven/core'
import { api } from '@/lib/api'
import { itemFavouriteEdits } from '@/lib/edits'
import { afterFavourites } from '@/lib/invalidate'
import { useOptimisticMutation } from '@/lib/optimistic'
import { mutationKeys } from '@/lib/queryClient'

/** Marking a show or season a favourite, shown on its page before the server answers. */
export const useItemFavourite = ({ item }: { item: ItemDetails }) => {
  const queryClient = useQueryClient()
  return useOptimisticMutation({
    mutationKey: mutationKeys.itemFavourite,
    mutationFn: (marked: boolean) => api.setItemFavourite({ id: item.id, favourite: marked }),
    edits: (marked) => itemFavouriteEdits({ item, favourite: marked }),
    settle: () => afterFavourites(queryClient),
  })
}
