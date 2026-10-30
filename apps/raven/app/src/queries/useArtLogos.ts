import { ITEM_IMAGE_KINDS } from '@raven/core'
import { useQueries } from '@tanstack/react-query'

import { type Picture, type Pictures, pictureAt } from '@/queries/cards'
import type { AppQueries } from '@/queries/useAppQueries'

type UseArtLogosProps = {
  queries: AppQueries['queries']
  /** The shows and films whose title art is wanted, by item id. */
  ids: readonly number[]
  pictures: Pictures | null
}

/**
 * Each show's or film's title art, by item id, for the cards that wear it. A summary carries no
 * logo's version, so each item's page is read for it, once, through the query cache the pages
 * share; one with no art, or not read yet, is left out.
 */
export const useArtLogos = ({
  queries,
  ids,
  pictures,
}: UseArtLogosProps): ReadonlyMap<number, Picture> =>
  useQueries({
    queries: [...new Set(ids)].map((id) => queries.itemQuery(id)),
    combine: (results) =>
      new Map(
        results.flatMap((result): [number, Picture][] => {
          const item = result.data
          const version = item?.logoVersion ?? null
          if (item === undefined || version === null || pictures === null) return []
          const logo = pictureAt({
            uri: pictures.api.itemImageUrl({ id: item.id, kind: ITEM_IMAGE_KINDS.logo, version }),
            headersFor: pictures.headersFor,
          })
          return logo === null ? [] : [[item.id, logo]]
        }),
      ),
  })
