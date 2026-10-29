import type { Transport } from '@/apiClient/transport'
import {
  type ChoosableImageKind,
  type FavouriteChange,
  ITEM_QUERY_PARAMS,
  type ImageChoice,
  isItemDetails,
  isItemImageOptions,
  isItemMetadataState,
  isMediaItem,
  isMediaList,
  isPersonDetails,
  type ItemDetails,
  type ItemImageOptions,
  type ItemMetadataChange,
  type ItemMetadataState,
  type LibraryImageChoice,
  type MediaItem,
  type PersonDetails,
  type ShowMatchChoice,
} from '@/contract'
import { toQueryString } from '@/query'
import { nullable } from '@/schema'

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
export const itemCalls = ({ send, expect }: Transport) => ({
  /** A movie, show, season or episode with everything its page shows. */
  getItem: (id: number): Promise<ItemDetails> =>
    expect({ request: send({ path: `/api/items/${id}` }), guard: isItemDetails }),

  /** Fetches an item from TMDB again now, and returns it as it stands after. */
  refreshItem: (id: number): Promise<ItemDetails> =>
    expect({
      request: send({ path: `/api/items/${id}/refresh`, method: 'POST' }),
      guard: isItemDetails,
    }),

  /** Marks a show or season a favourite, or not, and answers with its page. */
  setItemFavourite: ({ id, favourite }: SetItemFavouriteProps): Promise<ItemDetails> =>
    expect({
      request: send({
        path: `/api/items/${id}/favourite`,
        method: 'PUT',
        body: { favourite } satisfies FavouriteChange,
      }),
      guard: isItemDetails,
    }),

  /** The first episode of a show not yet watched, in whichever library holds it, or null when every one is. */
  nextEpisode: (showId: number): Promise<MediaItem | null> =>
    expect({
      request: send({ path: `/api/items/${showId}/next` }),
      guard: nullable(isMediaItem),
    }),

  /**
   * Episodes of a show or a season in a random order, the first to play
   * first, from whichever libraries hold them; empty with none to play.
   */
  shuffleEpisodes: (itemId: number): Promise<MediaItem[]> =>
    expect({
      request: send({ path: `/api/items/${itemId}/shuffle` }),
      guard: isMediaList,
    }),

  /** Points every file under a show at another show, keeping their numbers; returns the show they moved to. */
  setItemMatch: ({ itemId, tmdbId }: SetItemMatchProps): Promise<ItemDetails> =>
    expect({
      request: send({
        path: `/api/items/${itemId}/match`,
        method: 'PUT',
        body: { tmdbId } satisfies ShowMatchChoice,
      }),
      guard: isItemDetails,
    }),

  /** Edit metadata: what the page shows, what TMDB says, and which fields were written over. */
  getItemMetadata: (id: number): Promise<ItemMetadataState> =>
    expect({
      request: send({ path: `/api/items/${id}/metadata` }),
      guard: isItemMetadataState,
    }),

  /** Edit metadata: writes the fields given over TMDB's, or clears each sent as null. */
  setItemMetadata: ({ id, change }: SetItemMetadataProps): Promise<ItemDetails> =>
    expect({
      request: send({ path: `/api/items/${id}/metadata`, method: 'PUT', body: change }),
      guard: isItemDetails,
    }),

  /** Every poster and backdrop a movie or show could show, the one `libraryId` shows marked. */
  getItemImages: ({ id, libraryId }: GetItemImagesProps): Promise<ItemImageOptions> =>
    expect({
      request: send({
        path: `/api/items/${id}/images?${toQueryString({ [ITEM_QUERY_PARAMS.library]: String(libraryId) })}`,
      }),
      guard: isItemImageOptions,
    }),

  /**
   * Edit images: the item's cards in `libraryId` show `choice` for `kind`
   * from now on, and refreshes keep it; other libraries keep their own.
   */
  chooseItemImage: ({ id, kind, libraryId, choice }: ChooseItemImageProps): Promise<ItemDetails> =>
    expect({
      request: send({
        path: `/api/items/${id}/images/${kind}`,
        method: 'PUT',
        body: { libraryId, choice } satisfies LibraryImageChoice,
      }),
      guard: isItemDetails,
    }),

  /** A person, and everything in raven they are credited on. */
  getPerson: (id: number): Promise<PersonDetails> =>
    expect({ request: send({ path: `/api/people/${id}` }), guard: isPersonDetails }),
})
