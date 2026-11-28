import {
  type AlbumDetails,
  ITEM_TYPES,
  type ItemDetails,
  type MediaItem,
  MUSIC_LINKS,
  type MusicLink,
  type Track,
  episodesOf,
  musicLinksOf,
  mediaLabel,
  seasonsOf,
} from '@raven/core'
import { useServerAlbumFavourite, useServerMediaMutations } from '@raven/ui/headless'
import { useQuery } from '@tanstack/react-query'
import { useRouter } from 'expo-router'

import { useOwnerId } from '@/account/useOwnerId'
import { confirmDeleteVideo } from '@/cardMenu/confirmDeleteVideo'
import {
  type CardMenuOption,
  bingeOptionOf,
  deleteOptionOf,
  downloadOptionOf,
  favouriteOptionOf,
  linkOptionOf,
  musicLinkOptionOf,
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
import { ROUTE_TARGETS, hrefOf } from '@/routes'

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
 * own name and has no way up. The owner's menu ends in Delete this episode, or Delete this
 * movie, which asks before the file leaves the server.
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
  const isOwner = useOwnerId(session) !== null
  const { remove } = useServerMediaMutations({ api, media })
  // Awaited by the alert, which outlives the menu, so a refusal is still told once the menu is gone.
  const onDelete = () =>
    confirmDeleteVideo({
      name: mediaLabel(media),
      fileName: media.fileName,
      onDelete: () => remove.mutateAsync(),
    })
  return [
    ...downloadOptionsOf({ canDownload, download }),
    watchedOptionOf(marks.watched),
    ...(marks.favourite === null ? [] : [favouriteOptionOf(marks.favourite)]),
    ...links.map((link) => linkOptionOf({ link, onOpen })),
    ...(isOwner ? [deleteOptionOf({ media, onDelete })] : []),
  ]
}

/** Opens the album's page or the artist's a music menu's line goes to. */
const useOpenMusicLink = (): ((link: MusicLink) => void) => {
  const router = useRouter()
  return (link) =>
    router.push(
      hrefOf(
        link.kind === MUSIC_LINKS.album
          ? { kind: ROUTE_TARGETS.album, albumId: link.albumId }
          : { kind: ROUTE_TARGETS.artist, artistId: link.artistId },
      ),
    )
}

type UseAlbumMenuOptionsProps = {
  session: AppQueries
  details: AlbumDetails
  /** On the album's own page, where Go to album is left out. */
  isOnAlbum: boolean
}

/** An album's menu: its one mark, Favourite, then Go to album and Go to each of its artists. */
export const useAlbumMenuOptions = ({
  session,
  details,
  isOnAlbum,
}: UseAlbumMenuOptionsProps): CardMenuOption[] => {
  const favourite = useServerAlbumFavourite({ api: session.api, albumId: details.album.id })
  const onOpen = useOpenMusicLink()
  const { album } = details
  return [
    favouriteOptionOf({ isOn: details.isFavourite, onToggle: favourite.mutate }),
    ...musicLinksOf({ albumId: isOnAlbum ? null : album.id, artists: album.artists }).map((link) =>
      musicLinkOptionOf({ link, onOpen }),
    ),
  ]
}

type UseTrackMenuOptionsProps = { track: Track }

/** The playing track's menu: Go to its album and Go to each of its artists. */
export const useTrackMenuOptions = ({ track }: UseTrackMenuOptionsProps): CardMenuOption[] => {
  const onOpen = useOpenMusicLink()
  return musicLinksOf({ albumId: track.albumId, artists: track.artists }).map((link) =>
    musicLinkOptionOf({ link, onOpen }),
  )
}
