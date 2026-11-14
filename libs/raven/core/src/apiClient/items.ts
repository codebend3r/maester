import type { Transport } from '@/apiClient/transport'
import { ROUTES } from '@/routes'
import {
  type ChoosableImageKind,
  type FavouriteChange,
  ITEM_QUERY_PARAMS,
  type ImageChoice,
  type ItemDetails,
  type ItemImageOptions,
  type ItemMetadataChange,
  type ItemMetadataState,
  type LibraryImageChoice,
  type MediaItem,
  type PersonDetails,
  type ShowMatchChoice,
} from '@/contract'

type SetItemFavouriteProps = {
  id: number
  favourite: boolean
}

type SetItemMatchProps = { itemId: number; tmdbId: string }

type SetItemMetadataProps = {
  id: number
  change: ItemMetadataChange
}

type GetItemImagesProps = {
  id: number
  /** The library whose cards' pictures are being chosen. */
  libraryId: number
}

type ChooseItemImageProps = {
  id: number
  kind: ChoosableImageKind
  libraryId: number
  choice: ImageChoice
}

/** A movie, show, season or episode, and the people credited on it. */
export const itemCalls = ({ ask }: Transport) => ({
  /** A movie, show, season or episode with everything its page shows. */
  getItem: (id: number): Promise<ItemDetails> => ask({ route: ROUTES.getItem, params: { id } }),

  /** Fetches an item from TMDB again now, and returns it as it stands after. */
  refreshItem: (id: number): Promise<ItemDetails> =>
    ask({ route: ROUTES.refreshItem, params: { id } }),

  /** Marks a show or season a favourite, or not, and answers with its page. */
  setItemFavourite: ({ id, favourite }: SetItemFavouriteProps): Promise<ItemDetails> =>
    ask({
      route: ROUTES.setItemFavourite,
      params: { id },
      body: { favourite } satisfies FavouriteChange,
    }),

  /** The first episode of a show not yet watched, in whichever library holds it, or null when every one is. */
  nextEpisode: (showId: number): Promise<MediaItem | null> =>
    ask({ route: ROUTES.nextEpisode, params: { id: showId } }),

  /**
   * Episodes of a show or a season in a random order, the first to play
   * first, from whichever libraries hold them; empty with none to play.
   */
  shuffleEpisodes: (itemId: number): Promise<MediaItem[]> =>
    ask({ route: ROUTES.shuffleEpisodes, params: { id: itemId } }),

  /** Points every file under a show at another show, keeping their numbers; returns the show they moved to. */
  setItemMatch: ({ itemId, tmdbId }: SetItemMatchProps): Promise<ItemDetails> =>
    ask({
      route: ROUTES.setItemMatch,
      params: { id: itemId },
      body: { tmdbId } satisfies ShowMatchChoice,
    }),

  /** Edit metadata: what the page shows, what TMDB says, and which fields were written over. */
  getItemMetadata: (id: number): Promise<ItemMetadataState> =>
    ask({ route: ROUTES.getItemMetadata, params: { id } }),

  /** Edit metadata: writes the fields given over TMDB's, or clears each sent as null. */
  setItemMetadata: ({ id, change }: SetItemMetadataProps): Promise<ItemDetails> =>
    ask({ route: ROUTES.setItemMetadata, params: { id }, body: change }),

  /** Every poster and backdrop a movie or show could show, the one `libraryId` shows marked. */
  getItemImages: ({ id, libraryId }: GetItemImagesProps): Promise<ItemImageOptions> =>
    ask({
      route: ROUTES.getItemImages,
      params: { id },
      query: { [ITEM_QUERY_PARAMS.library]: String(libraryId) },
    }),

  /**
   * Edit images: the item's cards in `libraryId` show `choice` for `kind`
   * from now on, and refreshes keep it; other libraries keep their own.
   */
  chooseItemImage: ({ id, kind, libraryId, choice }: ChooseItemImageProps): Promise<ItemDetails> =>
    ask({
      route: ROUTES.chooseItemImage,
      params: { id, kind },
      body: { libraryId, choice } satisfies LibraryImageChoice,
    }),

  /** A person, and everything in raven they are credited on. */
  getPerson: (id: number): Promise<PersonDetails> =>
    ask({ route: ROUTES.getPerson, params: { id } }),
})
