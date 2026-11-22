import { ITEM_IMAGE_KINDS, type ItemDetails } from '@raven/core'
import { type UseQueryResult, useQueries } from '@tanstack/react-query'
import { useCallback } from 'react'

import { type Pictures, pictureAt } from '@/queries/cards'
import type { ShowArt, ShowArts } from '@/queries/showArt'
import type { AppQueries } from '@/queries/useAppQueries'

type UseShowArtsProps = {
  queries: AppQueries['queries']
  /** The shows and films whose art is wanted, by item id. */
  ids: readonly number[]
  pictures: Pictures | null
}

type ArtOfProps = { item: ItemDetails; pictures: Pictures }

type ArtPictureProps = {
  kind: typeof ITEM_IMAGE_KINDS.logo | typeof ITEM_IMAGE_KINDS.backdrop
  version: ItemDetails['logoVersion']
}

/** One show's or film's title art and backdrop, each null where it has none. */
const artOf = ({ item, pictures }: ArtOfProps): ShowArt => {
  const pictureOf = ({ kind, version }: ArtPictureProps) =>
    version === null
      ? null
      : pictureAt({
          uri: pictures.api.itemImageUrl({ id: item.id, kind, version }),
          headersFor: pictures.headersFor,
        })
  return {
    logo: pictureOf({ kind: ITEM_IMAGE_KINDS.logo, version: item.logoVersion }),
    backdrop: pictureOf({ kind: ITEM_IMAGE_KINDS.backdrop, version: item.backdropVersion }),
  }
}

/**
 * Each show's or film's title art and backdrop, by item id, for the cards that wear them. A
 * summary carries neither a logo's version nor an episode's show's backdrop, so each item's
 * page is read for them, once, through the query cache the pages share; one not read yet is
 * left out. The map is the same until a page lands or the pictures change, so Home builds its
 * shelves again only then.
 */
export const useShowArts = ({ queries, ids, pictures }: UseShowArtsProps): ShowArts => {
  const combine = useCallback(
    (results: UseQueryResult<ItemDetails>[]): ShowArts =>
      new Map(
        results.flatMap((result): [number, ShowArt][] => {
          const item = result.data
          return item === undefined || pictures === null
            ? []
            : [[item.id, artOf({ item, pictures })]]
        }),
      ),
    [pictures],
  )
  return useQueries({ queries: [...new Set(ids)].map((id) => queries.itemQuery(id)), combine })
}
