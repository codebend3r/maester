import { useQueryClient } from '@tanstack/react-query'
import type { ApiClient, ItemDetails } from '@raven/core'
import { itemFavouriteEdits } from '@/query/edits'
import { afterFavourites } from '@/query/invalidate'
import { useOptimisticMutation } from '@/query/optimistic'
import { mutationKeys } from '@/query/queryClient'

type UseServerItemFavouriteProps = { api: ApiClient; item: ItemDetails }

/** Marking a show or season a favourite, shown on its page before the server answers. */
export const useServerItemFavourite = ({ api, item }: UseServerItemFavouriteProps) => {
  const queryClient = useQueryClient()
  return useOptimisticMutation({
    mutationKey: mutationKeys.itemFavourite,
    mutationFn: (isMarked: boolean) => api.setItemFavourite({ id: item.id, favourite: isMarked }),
    edits: (isMarked) => itemFavouriteEdits({ item, favourite: isMarked }),
    settle: () => afterFavourites(queryClient),
  })
}

type ItemFavouriteForProps = { api: ApiClient }

type ItemFavouriteForUseItemFavouriteProps = { item: ItemDetails }

/** The show-and-season favourite hook over one server's `api`, for a host with one server. */
export const itemFavouriteFor = ({ api }: ItemFavouriteForProps) => ({
  useItemFavourite: ({ item }: ItemFavouriteForUseItemFavouriteProps) =>
    useServerItemFavourite({ api, item }),
})
