import { useQueries } from '@tanstack/react-query'
import { ITEM_TYPES, type ItemDetails, type MediaItem } from '@raven/core'

import { type BingeCard, bingeCardOf } from '@/queries/bingeCards'
import type { Pictures } from '@/queries/cards'
import { useBingeIds } from '@/queries/useBinge'
import type { AppQueries } from '@/queries/useAppQueries'

type UseBingeCardsProps = { queries: AppQueries['queries']; pictures: Pictures | null }

const isShow = (details: ItemDetails | undefined): details is ItemDetails =>
  (details?.type ?? null) === ITEM_TYPES.show

/**
 * The account's binged shows as Home's Binge cards, in the list's order: each show's page, the
 * episode it is on, and that episode's page for its synopsis. A show still being read, or one
 * that is no show, is left out until it can be drawn.
 */
export const useBingeCards = ({ queries, pictures }: UseBingeCardsProps): BingeCard[] => {
  const ids = useBingeIds()
  const shows = useQueries({ queries: ids.map((id) => queries.itemQuery(id)) })
  const nexts = useQueries({ queries: ids.map((id) => queries.nextEpisodeQuery(id)) })
  const nextOf = (index: number): MediaItem | null => nexts[index]?.data ?? null
  const episodes = useQueries({
    queries: ids.map((_, index) => queries.itemQuery(nextOf(index)?.item?.id ?? null)),
  })
  if (pictures === null) return []
  return shows.flatMap(({ data }, index) =>
    isShow(data)
      ? [
          bingeCardOf({
            show: data,
            next: nextOf(index),
            episode: episodes[index]?.data ?? null,
            ...pictures,
          }),
        ]
      : [],
  )
}
