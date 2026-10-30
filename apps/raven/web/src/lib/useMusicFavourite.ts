import { musicFavouritesFor } from '@raven/ui/headless'
import { api } from '@/lib/api'

export const { useAlbumFavourite, useArtistFavourite } = musicFavouritesFor({ api })
