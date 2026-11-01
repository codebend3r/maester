import { ITEM_IMAGE_KINDS } from '@raven/core'
import { useQueries } from '@tanstack/react-query'

import { type Pictures, pictureAt } from '@/queries/cards'
import type { ShowArt, ShowArts } from '@/queries/showArt'
import type { AppQueries } from '@/queries/useAppQueries'

type UseShowArtsProps = {
  queries: AppQueries['queries']
  /** The shows and films whose art is wanted, by item id. */
  ids: readonly number[]
  pictures: Pictures | null
}

/**
 * Each show's or film's title art and backdrop, by item id, for the cards that wear them. A
 * summary carries neither a logo's version nor an episode's show's backdrop, so each item's
 * page is read for them, once, through the query cache the pages share; one not read yet is
 * left out.
 */
export const useShowArts = ({ queries, ids, pictures }: UseShowArtsProps): ShowArts =>
  useQueries({
    queries: [...new Set(ids)].map((id) => queries.itemQuery(id)),
    combine: (results) =>
      new Map(
        results.flatMap((result): [number, ShowArt][] => {
          const item = result.data
          if (item === undefined || pictures === null) return []
          const pictureOf = (
            kind: typeof ITEM_IMAGE_KINDS.logo | typeof ITEM_IMAGE_KINDS.backdrop,
          ) => {
            const version = kind === ITEM_IMAGE_KINDS.logo ? item.logoVersion : item.backdropVersion
            return version === null
              ? null
              : pictureAt({
                  uri: pictures.api.itemImageUrl({ id: item.id, kind, version }),
                  headersFor: pictures.headersFor,
                })
          }
          return [
            [
              item.id,
              {
                logo: pictureOf(ITEM_IMAGE_KINDS.logo),
                backdrop: pictureOf(ITEM_IMAGE_KINDS.backdrop),
              },
            ],
          ]
        }),
      ),
  })
