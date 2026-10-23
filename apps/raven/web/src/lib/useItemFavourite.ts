import { itemFavouriteFor } from '@raven/ui/headless'
import { api } from '@/lib/api'

export const { useItemFavourite } = itemFavouriteFor({ api })
