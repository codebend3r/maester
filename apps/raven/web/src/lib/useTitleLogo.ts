import {
  ITEM_IMAGE_KINDS,
  ITEM_TYPES,
  type ItemDetails,
  type MediaItem,
  episodeCode,
} from '@raven/core'
import type { TitleLogo } from '@raven/ui/headless'
import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { itemQuery } from '@/lib/queries'

type CaptionOfProps = { item: MediaItem['item'] }

/** What a show's art leaves out of an episode: "S01E02 · Half Loop". Null for anything else. */
const captionOf = ({ item }: CaptionOfProps): string | null => {
  if (item?.type !== ITEM_TYPES.episode) return null
  const parts = [episodeCode(item), item.title].filter((part): part is string => !!part)
  return parts.length > 0 ? parts.join(' · ') : null
}

type TitleLogoOfProps = {
  media: MediaItem
  /** The page whose art stands for the title: an episode's show's, else the video's own item's. */
  art: Pick<ItemDetails, 'id' | 'title' | 'logoVersion'> | undefined
}

/**
 * The art the player's header draws in place of the title's name, as the
 * Continue watching tiles do: a film's logo, or an episode's show's with the
 * episode's place and name beside it. Null without a logo.
 */
const titleLogoOf = ({ media, art }: TitleLogoOfProps): TitleLogo | null => {
  if (art === undefined) return null
  const url = api.itemImageUrl({
    id: art.id,
    kind: ITEM_IMAGE_KINDS.logo,
    version: art.logoVersion,
  })
  if (url === null) return null
  return { url, name: art.title, caption: captionOf({ item: media.item }) }
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
  const artId = media?.item?.show?.id ?? media?.item?.id ?? null
  const art = useQuery(itemQuery(artId)).data
  if (media === null) return null
  return titleLogoOf({ media, art })
}
