import { ITEM_IMAGE_KINDS, type ItemDetails, type MediaItem, artItemIdOf } from '@raven/core'
import type { TitleLogo } from '@raven/ui/headless'
import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { itemQuery } from '@/lib/queries'

type TitleLogoOfProps = {
  /** The page whose art stands for the title: an episode's show's, else the video's own item's. */
  art: Pick<ItemDetails, 'id' | 'title' | 'logoVersion'> | undefined
}

/**
 * The art the player's header draws in place of the title's name, as the
 * Continue watching tiles do: a film's logo, or an episode's show's, whose
 * own title and number the header sets under it. Null without a logo.
 */
const titleLogoOf = ({ art }: TitleLogoOfProps): TitleLogo | null => {
  if (art === undefined) return null
  const url = api.itemImageUrl({
    id: art.id,
    kind: ITEM_IMAGE_KINDS.logo,
    version: art.logoVersion,
  })
  if (url === null) return null
  return { url, name: art.title }
}

type UseTitleLogoProps = {
  /** The video on screen, or null while there is none to ask about. */
  media: MediaItem | null
}

/**
 * The title's art for the player's header whenever it has some, whatever Settings says of
 * titles elsewhere; null without, and the player spells the title out in its display face.
 */
export const useTitleLogo = ({ media }: UseTitleLogoProps): TitleLogo | null => {
  const artId = media?.item == null ? null : artItemIdOf(media.item)
  const art = useQuery(itemQuery(artId)).data
  if (media === null) return null
  return titleLogoOf({ art })
}
