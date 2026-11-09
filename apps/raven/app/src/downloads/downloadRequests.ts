import {
  type AlbumSummary,
  type ApiClient,
  type ItemDetails,
  ITEM_IMAGE_KINDS,
  type Library,
  type MediaItem,
  type PlaylistSummary,
  type Track,
  artistNames,
  episodeCode,
  episodesOf,
  formatRuntime,
  libraryIconOf,
  mediaLabel,
  seasonsOf,
} from '@raven/core'

import {
  type AskedGroup,
  DOWNLOAD_KINDS,
  type DownloadLibrary,
  type DownloadRequest,
  GROUP_KINDS,
  type VideoRequest,
} from '@/downloads/downloadEntries'
import { videoWayOf } from '@/downloads/downloadWays'
import type { AppPlatform } from '@/platform/platform'
import { imageOf } from '@/queries/cards'
import type { DownloadProps } from '@/stores/downloads'

/** What `useDownloads`' `download` is asked, but for the server and the library, which the screen knows. */
export type DownloadAsk = Omit<DownloadProps, 'serverId' | 'library'>

type DownloadLibraryOfProps = {
  libraries: readonly Library[]
  libraryId: number | null
}

/** The library a download is filed under, as the server lists it now; null when it is not known here. */
export const downloadLibraryOf = ({
  libraries,
  libraryId,
}: DownloadLibraryOfProps): DownloadLibrary | null => {
  const library = libraries.find(({ id }) => id === libraryId)
  if (library === undefined) return null
  return {
    id: library.id,
    name: library.name,
    icon: libraryIconOf(library.settings),
    isLocked: library.settings.locked,
  }
}

/** An episode's place in its season: its number, a big step per season so seasons keep apart. */
const SEASON_STEP = 10_000

/** A track's place on its album: its number, a big step per disc. */
const DISC_STEP = 1_000

type GroupOfProps = Omit<AskedGroup, 'season'> & { season?: number }

/** What a download is filed under; only a show's season has a `season`. */
const groupOf = ({ kind, id, title, season }: GroupOfProps): AskedGroup => ({
  kind,
  id,
  title,
  season: season ?? null,
})

type VideoRequestOfProps = {
  platform: AppPlatform
  media: MediaItem
  title: string
  line: string
  order: number
}

/** A video to download, or nothing when this device can take it no way. */
const videoRequestOf = ({
  platform,
  media,
  title,
  line,
  order,
}: VideoRequestOfProps): VideoRequest[] => {
  const { way } = videoWayOf({ platform, media })
  return way === null ? [] : [{ kind: DOWNLOAD_KINDS.video, media, way, title, line, order }]
}

type PosterOfProps = { api: ApiClient; details: ItemDetails }

const posterOf = ({ api, details }: PosterOfProps): string | null =>
  imageOf({ api, item: details, kind: ITEM_IMAGE_KINDS.poster })

type LogoOfProps = { api: ApiClient; details: ItemDetails | null }

/** A show's or movie's title art, which Downloads names it by; null when it has none. */
export const logoOf = ({ api, details }: LogoOfProps): string | null =>
  details === null
    ? null
    : api.itemImageUrl({
        id: details.id,
        kind: ITEM_IMAGE_KINDS.logo,
        version: details.logoVersion,
      })

type MovieAskOfProps = {
  api: ApiClient
  platform: AppPlatform
  details: ItemDetails
  media: MediaItem
}

/** A movie's file, under the movie, wearing its poster. */
export const movieAskOf = ({ api, platform, details, media }: MovieAskOfProps): DownloadAsk => ({
  group: groupOf({ kind: GROUP_KINDS.movie, id: details.id, title: details.title }),
  artUri: posterOf({ api, details }),
  logoUri: logoOf({ api, details }),
  items: videoRequestOf({
    platform,
    media,
    title: details.title,
    line: details.year === null ? mediaLabel(media) : String(details.year),
    order: 0,
  }),
})

type FileAskOfProps = {
  api: ApiClient
  platform: AppPlatform
  media: MediaItem
}

/** A lone video with no page of its own, under itself, wearing its frame grab. */
export const fileAskOf = ({ api, platform, media }: FileAskOfProps): DownloadAsk => ({
  group: groupOf({ kind: GROUP_KINDS.video, id: media.id, title: media.title }),
  artUri: api.thumbnailUrl(media),
  logoUri: null,
  items: videoRequestOf({
    platform,
    media,
    title: media.title,
    line: formatRuntime(media.duration) ?? mediaLabel(media),
    order: 0,
  }),
})

type ShowOf = Pick<ItemDetails, 'id' | 'title'>

type SeasonGroupOfProps = { show: ShowOf; season: number }

const seasonGroupOf = ({ show, season }: SeasonGroupOfProps): AskedGroup =>
  groupOf({ kind: GROUP_KINDS.show, id: show.id, title: show.title, season })

type EpisodeItemOfProps = {
  platform: AppPlatform
  media: MediaItem
  title: string
  season: number
  episode: number | null
}

const episodeItemOf = ({
  platform,
  media,
  title,
  season,
  episode,
}: EpisodeItemOfProps): VideoRequest[] =>
  videoRequestOf({
    platform,
    media,
    title,
    line: episodeCode({ season, episode }) ?? mediaLabel(media),
    order: season * SEASON_STEP + (episode ?? 0),
  })

type EpisodeAskOfProps = {
  platform: AppPlatform
  details: ItemDetails
  media: MediaItem
  /** The show's poster, which its episodes share; null until the show is read. */
  artUri: string | null
  /** The show's title art; null until the show is read, or when it has none. */
  logoUri: string | null
}

/** One episode's file, under its show's season. */
export const episodeAskOf = ({
  platform,
  details,
  media,
  artUri,
  logoUri,
}: EpisodeAskOfProps): DownloadAsk => {
  const show = details.show ?? { id: details.id, title: details.title }
  const season = details.season ?? 0
  return {
    group: seasonGroupOf({ show, season }),
    artUri,
    logoUri,
    items: episodeItemOf({
      platform,
      media,
      title: details.title,
      season,
      episode: details.episode,
    }),
  }
}

type SeasonAskOfProps = {
  api: ApiClient
  platform: AppPlatform
  /** The season's page, which lists its episodes. */
  season: ItemDetails
  /** The show, for its name and its poster; the season's own when it is not read yet. */
  show: ItemDetails | null
}

/** Every episode of a season that has a file this device can take. */
export const seasonAskOf = ({ api, platform, season, show }: SeasonAskOfProps): DownloadAsk => {
  const owner = show ?? season
  const number = season.season ?? 0
  return {
    group: seasonGroupOf({ show: season.show ?? owner, season: number }),
    artUri: posterOf({ api, details: owner }),
    logoUri: logoOf({ api, details: show }),
    items: episodesOf(season).flatMap((episode) =>
      episode.primary === null
        ? []
        : episodeItemOf({
            platform,
            media: episode.primary,
            title: episode.title,
            season: number,
            episode: episode.episode,
          }),
    ),
  }
}

type ShowAsksOfProps = {
  api: ApiClient
  platform: AppPlatform
  show: ItemDetails
}

/** Every season of a show, each read from the server for its episodes, one ask a season. */
export const showAsksOf = async ({
  api,
  platform,
  show,
}: ShowAsksOfProps): Promise<DownloadAsk[]> => {
  const seasons = await Promise.all(seasonsOf(show).map((season) => api.getItem(season.id)))
  return seasons.map((season) => seasonAskOf({ api, platform, season, show }))
}

type TrackItemOfProps = { track: Track; order: number }

const trackItemOf = ({ track, order }: TrackItemOfProps): DownloadRequest => ({
  kind: DOWNLOAD_KINDS.track,
  track,
  title: track.title,
  line: artistNames(track),
  order,
})

type AlbumAskOfProps = {
  api: ApiClient
  album: AlbumSummary
  tracks: readonly Track[]
}

/** An album's tracks, in disc and track order, under the album, wearing its cover. */
export const albumAskOf = ({ api, album, tracks }: AlbumAskOfProps): DownloadAsk => ({
  group: groupOf({ kind: GROUP_KINDS.album, id: album.id, title: album.title }),
  artUri: api.albumCoverUrl({ albumId: album.id, coverVersion: album.coverVersion }),
  logoUri: null,
  items: tracks.map((track) =>
    trackItemOf({ track, order: track.disc * DISC_STEP + (track.number ?? 0) }),
  ),
})

type PlaylistAskOfProps = {
  api: ApiClient
  playlist: Pick<PlaylistSummary, 'id' | 'name'>
  tracks: readonly Track[]
}

/** A playlist's tracks in its order, under the playlist, wearing its first track's cover. */
export const playlistAskOf = ({ api, playlist, tracks }: PlaylistAskOfProps): DownloadAsk => {
  const [first] = tracks
  return {
    group: groupOf({ kind: GROUP_KINDS.playlist, id: playlist.id, title: playlist.name }),
    artUri:
      first === undefined
        ? null
        : api.albumCoverUrl({ albumId: first.albumId, coverVersion: first.album.coverVersion }),
    logoUri: null,
    items: tracks.map((track, order) => trackItemOf({ track, order })),
  }
}
