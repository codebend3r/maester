import { ITEM_IMAGE_KINDS, type MediaItem } from '@raven/core'
import { useQuery } from '@tanstack/react-query'

import { type PlayerHeading, playerHeadingOf } from '@/layouts/playerHeading'
import { pictureAt } from '@/queries/cards'
import type { AppQueries } from '@/queries/useAppQueries'
import { usePictures } from '@/queries/usePictures'

type UsePlayerHeadingProps = { media: MediaItem; session: AppQueries }

/**
 * The heading over a playing video, with an episode's show's title art: the show's page is read
 * for its logo's version, and the picture asked for with the server's headers once they are known.
 */
export const usePlayerHeading = ({ media, session }: UsePlayerHeadingProps): PlayerHeading => {
  const showId = media.item?.show?.id ?? null
  const show = useQuery(session.queries.itemQuery(showId))
  const pictures = usePictures(session)
  const version = show.data?.logoVersion ?? null
  const logo =
    showId === null || version === null || pictures === null
      ? null
      : pictureAt({
          uri: pictures.api.itemImageUrl({ id: showId, kind: ITEM_IMAGE_KINDS.logo, version }),
          headersFor: pictures.headersFor,
        })
  return playerHeadingOf({ media, logo })
}
