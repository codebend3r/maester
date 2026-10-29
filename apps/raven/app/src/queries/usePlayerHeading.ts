import { ITEM_IMAGE_KINDS, type MediaItem } from '@raven/core'
import { useQuery } from '@tanstack/react-query'

import { type PlayerHeading, playerHeadingOf } from '@/layouts/playerHeading'
import { pictureAt } from '@/queries/cards'
import type { AppQueries } from '@/queries/useAppQueries'
import { usePictures } from '@/queries/usePictures'

type UsePlayerHeadingProps = { media: MediaItem; session: AppQueries }

/**
 * The heading over a playing video, with its title art: an episode's show's, else the item's
 * own (a film's). That page is read for its logo's version, and the picture asked for with the
 * server's headers once they are known.
 */
export const usePlayerHeading = ({ media, session }: UsePlayerHeadingProps): PlayerHeading => {
  const artId = media.item?.show?.id ?? media.item?.id ?? null
  const art = useQuery(session.queries.itemQuery(artId))
  const pictures = usePictures(session)
  const version = art.data?.logoVersion ?? null
  const logo =
    artId === null || version === null || pictures === null
      ? null
      : pictureAt({
          uri: pictures.api.itemImageUrl({ id: artId, kind: ITEM_IMAGE_KINDS.logo, version }),
          headersFor: pictures.headersFor,
        })
  return playerHeadingOf({ media, logo })
}
