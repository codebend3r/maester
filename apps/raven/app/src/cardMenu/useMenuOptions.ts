import {
  type AlbumDetails,
  ITEM_TYPES,
  type ItemDetails,
  type MediaItem,
  episodesOf,
  seasonsOf,
} from '@raven/core'
import { useServerAlbumFavourite } from '@raven/ui/headless'
import { useQuery } from '@tanstack/react-query'
import { useRouter } from 'expo-router'

import {
  type CardMenuOption,
  bingeOptionOf,
  downloadOptionOf,
  favouriteOptionOf,
  linkOptionOf,
  watchedOptionOf,
} from '@/cardMenu/menuOptions'
import { itemTargetOf, videoTargetOf } from '@/downloads/downloadTargets'
import type { DownloadButton } from '@/downloads/downloadControl'
import { useDownloadButton } from '@/downloads/useDownloadButton'
import { DEVICE_PLATFORM } from '@/platform/devicePlatform'
import type { ItemLink } from '@/queries/itemLinks'
import type { AppQueries } from '@/queries/useAppQueries'
import { useDownloadLibrary } from '@/queries/useDownloadLibrary'
import { useItemMarks, useVideoMarks } from '@/queries/useMarks'
import { useVideoLinks } from '@/queries/useVideoLinks'
import { hrefOf } from '@/routes'

/** What every menu's options are built from: the server, and whether this device downloads. */
type MenuOptionsProps = {
  session: AppQueries
  /** Whether the menu offers Download at all; a TV's never does. */
  canDownload: boolean
}

type DownloadOptionsOfProps = { canDownload: boolean; download: DownloadButton }

/** The download line, where this device downloads at all. */
const downloadOptionsOf = ({ canDownload, download }: DownloadOptionsOfProps): CardMenuOption[] =>
  canDownload ? downloadOptionOf(download) : []

/** The library a season's files are in: its first episode's with a file; null for none. */
const seasonLibraryOf = (season: ItemDetails | null): number | null =>
  season === null
    ? null
    : (episodesOf(season).find((episode) => episode.primary !== null)?.primary?.libraryId ?? null)

type UseItemMenuOptionsProps = MenuOptionsProps & { details: ItemDetails }

/**
 * A show's or a season's menu: Download for every episode this device can take, filed under the
 * library its files are in (a season's first episode's, a show's first season's), then Watched
 * over every episode under it, Favourite where the server says it can be one, and for a show
 * Binge, faint while three other shows fill the list. Each mark goes through the hooks its page
 * uses, so it shows at once on the page and in every list.
 */
export const useItemMenuOptions = ({
  session,
  canDownload,
  details,
}: UseItemMenuOptionsProps): CardMenuOption[] => {
  const { queries, api } = session
  const marks = useItemMarks({ session, details })
  const isSeason = details.type === ITEM_TYPES.season
  // A season's show, for its name and poster; a show's first season, for the library its files are in.
  const show = useQuery(queries.itemQuery(isSeason ? (details.show?.id ?? null) : null))
  const firstSeason = useQuery(
    queries.itemQuery(isSeason ? null : (seasonsOf(details)[0]?.id ?? null)),
  )
  const library = useDownloadLibrary({
    session,
    libraryId: seasonLibraryOf(isSeason ? details : (firstSeason.data ?? null)),
  })
  const download = useDownloadButton({
    serverId: session.server.id,
    library,
    target: itemTargetOf({ api, platform: DEVICE_PLATFORM, details, show: show.data ?? null }),
  })
  return [
    ...downloadOptionsOf({ canDownload, download }),
    watchedOptionOf(marks.watched),
    ...(marks.favourite === null ? [] : [favouriteOptionOf(marks.favourite)]),
    ...(marks.binge === null ? [] : [bingeOptionOf(marks.binge)]),
  ]
}

type UseVideoMenuOptionsProps = MenuOptionsProps & { media: MediaItem }

/**
 * A movie's or an episode's menu: Download for its file (or the server's copy, or why neither),
 * Watched and Favourite unless its library is locked, as its page offers them, then its ways
 * up: an episode's show and season, a movie's saga. A file with no page downloads under its
 * own name and has no way up.
 */
export const useVideoMenuOptions = ({
  session,
  canDownload,
  media,
}: UseVideoMenuOptionsProps): CardMenuOption[] => {
  const router = useRouter()
  const { queries, api } = session
  const marks = useVideoMarks({ session, media })
  const details = useQuery(queries.itemQuery(media.item?.id ?? null))
  const { links, show } = useVideoLinks({ session, media, details: details.data ?? null })
  const library = useDownloadLibrary({ session, libraryId: media.libraryId })
  const download = useDownloadButton({
    serverId: session.server.id,
    library,
    target: videoTargetOf({
      api,
      platform: DEVICE_PLATFORM,
      media,
      details: details.data ?? null,
      show,
    }),
  })
  const onOpen = (link: ItemLink) => router.push(hrefOf(link.target))
  return [
    ...downloadOptionsOf({ canDownload, download }),
    watchedOptionOf(marks.watched),
    ...(marks.favourite === null ? [] : [favouriteOptionOf(marks.favourite)]),
    ...links.map((link) => linkOptionOf({ link, onOpen })),
  ]
}

type UseAlbumMenuOptionsProps = { session: AppQueries; details: AlbumDetails }

/** An album's one mark: Favourite. */
export const useAlbumMenuOptions = ({
  session,
  details,
}: UseAlbumMenuOptionsProps): CardMenuOption[] => {
  const favourite = useServerAlbumFavourite({ api: session.api, albumId: details.album.id })
  return [favouriteOptionOf({ isOn: details.isFavourite, onToggle: favourite.mutate })]
}
