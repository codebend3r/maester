import { ITEM_TYPES, type ItemDetails, type MediaItem } from '@raven/core'
import { useQuery } from '@tanstack/react-query'

import { type ItemLink, videoLinksOf } from '@/queries/itemLinks'
import type { AppQueries } from '@/queries/useAppQueries'

type UseVideoLinksProps = {
  session: AppQueries
  media: MediaItem
  /** The video's page; null for a file with no page, which has no way up. */
  details: ItemDetails | null
}

/** The ways up from a video, and the show they were read from. */
export type VideoLinks = {
  links: readonly ItemLink[]
  /** An episode's show, once read; null for anything else, or until it is read. */
  show: ItemDetails | null
  /** Whether an episode's show is still being read. */
  isShowPending: boolean
}

/**
 * The ways up from a video, read as the item page and a card's menu both read them: an
 * episode's show, whose seasons name the one it is in, and a movie's saga from its library's
 * sagas. Only what the video's type needs is asked for.
 */
export const useVideoLinks = ({ session, media, details }: UseVideoLinksProps): VideoLinks => {
  const { queries } = session
  const type = details?.type ?? null
  const isEpisode = type === ITEM_TYPES.episode
  const showId = isEpisode ? (details?.show?.id ?? null) : null
  const show = useQuery(queries.itemQuery(showId))
  const isMovie = type === ITEM_TYPES.movie
  const sagas = useQuery(queries.sagasQuery(isMovie ? media.libraryId : null))
  return {
    links: videoLinksOf({
      details,
      show: show.data ?? null,
      libraryId: media.libraryId,
      sagas: sagas.data ?? [],
    }),
    show: show.data ?? null,
    isShowPending: showId !== null && show.isPending,
  }
}
