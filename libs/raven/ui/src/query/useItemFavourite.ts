import { useQueryClient } from '@tanstack/react-query'
import type { ApiClient, ItemDetails } from '@raven/core'
import { itemFavouriteEdits } from '@/query/edits'
import { afterFavourites } from '@/query/invalidate'
import { useOptimisticMutation } from '@/query/optimistic'
import { mutationKeys } from '@/query/queryClient'

/** Marking a show or season a favourite, shown on its page before the server answers. */
export const useServerItemFavourite = ({ api, item }: { api: ApiClient; item: ItemDetails }) => {
  const queryClient = useQueryClient()
  return useOptimisticMutation({
    mutationKey: mutationKeys.itemFavourite,
    mutationFn: (marked: boolean) => api.setItemFavourite({ id: item.id, favourite: marked }),
    edits: (marked) => itemFavouriteEdits({ item, favourite: marked }),
    settle: () => afterFavourites(queryClient),
  })
}

/** The show-and-season favourite hook over one server's `api`, for a host with one server. */
export const itemFavouriteFor = ({ api }: { api: ApiClient }) => ({
  useItemFavourite: ({ item }: { item: ItemDetails }) => useServerItemFavourite({ api, item }),
})
