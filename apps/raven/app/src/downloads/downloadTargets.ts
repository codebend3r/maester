import {
  type AlbumSummary,
  type ApiClient,
  ITEM_IMAGE_KINDS,
  ITEM_TYPES,
  type ItemDetails,
  type MediaItem,
  type PlaylistSummary,
  type Track,
  episodesOf,
  seasonsOf,
} from '@raven/core'

import { DOWNLOAD_COPY } from '@/downloads/copy'
import { DOWNLOAD_KINDS, type DownloadEntry, GROUP_KINDS } from '@/downloads/downloadEntries'
import {
  type DownloadAsk,
  albumAskOf,
  episodeAskOf,
  fileAskOf,
  logoOf,
  movieAskOf,
  playlistAskOf,
  seasonAskOf,
  showAsksOf,
} from '@/downloads/downloadRequests'
import { videoWayOf } from '@/downloads/downloadWays'
import type { AppPlatform } from '@/platform/platform'
import { imageOf } from '@/queries/cards'

/**
 * What a Download button or a card's menu stands for: which downloads are its, how many files it
 * wants, why none can come, and what to ask the store for once pressed.
 */
export type DownloadTarget = {
  /** What it downloads, said in its label and in the alert before a delete. */
  name: string
  /** Whether a download in the store is one of its: a movie's file, a season's episodes, an album's tracks. */
  isFor: (entry: DownloadEntry) => boolean
  /** How many files it stands for, to tell some downloaded from all. */
  wanted: number
  /** Why nothing of it can download to this device; null when it can. */
  blocked: string | null
  /** What to ask for, read only once pressed: a show's seasons are read then. */
  asks: () => Promise<readonly DownloadAsk[]>
}

type Platformed = { api: ApiClient; platform: AppPlatform }

type OneVideoTargetOfProps = {
  platform: AppPlatform
  media: MediaItem
  name: string
  ask: () => DownloadAsk
}

/** One video's Download: its one file, or why it can come to this device no way. */
const oneVideoTargetOf = ({
  platform,
  media,
  name,
  ask,
}: OneVideoTargetOfProps): DownloadTarget => {
  const way = videoWayOf({ platform, media })
  return {
    name,
    isFor: (entry) => entry.mediaId === media.id,
    wanted: 1,
    blocked: way.way === null ? way.reason : null,
    asks: async () => [ask()],
  }
}

type MovieTargetOfProps = Platformed & { details: ItemDetails; media: MediaItem }

/** A movie's Download: its file, or the server's MP4 copy, or none and why. */
export const movieTargetOf = ({
  api,
  platform,
  details,
  media,
}: MovieTargetOfProps): DownloadTarget =>
  oneVideoTargetOf({
    platform,
    media,
    name: details.title,
    ask: () => movieAskOf({ api, platform, details, media }),
  })

type EpisodeTargetOfProps = MovieTargetOfProps & {
  /** The episode's show, for its poster; null until it is read. */
  show: ItemDetails | null
}

/** An episode's Download: its file under its show's season, wearing the show's poster. */
export const episodeTargetOf = ({
  api,
  platform,
  details,
  media,
  show,
}: EpisodeTargetOfProps): DownloadTarget =>
  oneVideoTargetOf({
    platform,
    media,
    name: details.title,
    ask: () =>
      episodeAskOf({
        platform,
        details,
        media,
        artUri: imageOf({ api, item: show, kind: ITEM_IMAGE_KINDS.poster }),
        logoUri: logoOf({ api, details: show }),
      }),
  })

type FileTargetOfProps = Platformed & { media: MediaItem }

/** A lone video's Download, one with no page: under its own name, wearing its frame grab. */
export const fileTargetOf = ({ api, platform, media }: FileTargetOfProps): DownloadTarget =>
  oneVideoTargetOf({
    platform,
    media,
    name: media.title,
    ask: () => fileAskOf({ api, platform, media }),
  })

type VideoTargetOfProps = Platformed & {
  media: MediaItem
  /** The video's page; null for a file with no page. */
  details: ItemDetails | null
  /** An episode's show, once read; null for a movie, a file, or until it is read. */
  show: ItemDetails | null
}

/** A video's Download by what it is: a movie's, an episode's, or a lone file's. */
export const videoTargetOf = ({
  api,
  platform,
  media,
  details,
  show,
}: VideoTargetOfProps): DownloadTarget => {
  const type = details?.type ?? null
  if (details !== null && type === ITEM_TYPES.movie) {
    return movieTargetOf({ api, platform, details, media })
  }
  if (details !== null && type === ITEM_TYPES.episode) {
    return episodeTargetOf({ api, platform, details, media, show })
  }
  return fileTargetOf({ api, platform, media })
}

type IsOfShowProps = { entry: DownloadEntry; showId: number; season: number | null }

/** Whether a download is one of a show's episodes, or of one season's when `season` names one. */
const isOfShow = ({ entry, showId, season }: IsOfShowProps): boolean =>
  entry.kind === DOWNLOAD_KINDS.video &&
  entry.group.kind === GROUP_KINDS.show &&
  entry.group.id === showId &&
  (season === null || entry.group.season === season)

type SeasonTargetOfProps = Platformed & {
  season: ItemDetails
  /** The show, for its name and its poster; null until it is read. */
  show: ItemDetails | null
}

/** A season's Download: every episode this device can take, under the show. */
export const seasonTargetOf = ({
  api,
  platform,
  season,
  show,
}: SeasonTargetOfProps): DownloadTarget => {
  const takes = episodesOf(season).filter(
    (episode) =>
      episode.primary !== null && videoWayOf({ platform, media: episode.primary }).way !== null,
  )
  const showId = season.show?.id ?? season.id
  return {
    name: season.title,
    isFor: (entry) => isOfShow({ entry, showId, season: season.season ?? 0 }),
    wanted: takes.length,
    blocked: takes.length === 0 ? DOWNLOAD_COPY.cantDownload : null,
    asks: async () => [seasonAskOf({ api, platform, season, show })],
  }
}

type ShowTargetOfProps = Platformed & { show: ItemDetails }

/** A show's Download: every season's episodes, each season read from the server once pressed. */
export const showTargetOf = ({ api, platform, show }: ShowTargetOfProps): DownloadTarget => {
  const wanted = seasonsOf(show).reduce((sum, season) => sum + season.episodeCount, 0)
  return {
    name: show.title,
    isFor: (entry) => isOfShow({ entry, showId: show.id, season: null }),
    wanted,
    blocked: wanted === 0 ? DOWNLOAD_COPY.cantDownload : null,
    asks: () => showAsksOf({ api, platform, show }),
  }
}

type ItemTargetOfProps = Platformed & {
  details: ItemDetails
  /** A season's show, once read; null for a show, or until it is read. */
  show: ItemDetails | null
}

/**
 * A show's or a season's Download by what it is. Any other page read as an item (a movie's, an
 * episode's) is taken as a show with no seasons, which has nothing to download and says so.
 */
export const itemTargetOf = ({ api, platform, details, show }: ItemTargetOfProps): DownloadTarget =>
  details.type === ITEM_TYPES.season
    ? seasonTargetOf({ api, platform, season: details, show })
    : showTargetOf({ api, platform, show: details })

type TracksTargetOfProps = { tracks: readonly Track[] }

/** Whether a download is one of these tracks. */
const isOfTracks =
  ({ tracks }: TracksTargetOfProps) =>
  (entry: DownloadEntry): boolean =>
    tracks.some(({ id }) => id === entry.mediaId)

type AlbumTargetOfProps = { api: ApiClient; album: AlbumSummary; tracks: readonly Track[] }

/** An album's Download: its tracks, as their files or as AAC where AVPlayer cannot decode one. */
export const albumTargetOf = ({ api, album, tracks }: AlbumTargetOfProps): DownloadTarget => ({
  name: album.title,
  isFor: isOfTracks({ tracks }),
  wanted: tracks.length,
  blocked: null,
  asks: async () => [albumAskOf({ api, album, tracks })],
})

type PlaylistTargetOfProps = {
  api: ApiClient
  playlist: Pick<PlaylistSummary, 'id' | 'name'>
  tracks: readonly Track[]
}

/** A playlist's Download: its tracks in its order; one already downloaded with its album stays there. */
export const playlistTargetOf = ({
  api,
  playlist,
  tracks,
}: PlaylistTargetOfProps): DownloadTarget => ({
  name: playlist.name,
  isFor: isOfTracks({ tracks }),
  wanted: tracks.length,
  blocked: null,
  asks: async () => [playlistAskOf({ api, playlist, tracks })],
})
