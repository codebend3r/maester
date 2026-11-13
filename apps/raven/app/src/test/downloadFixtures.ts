import { mediaItemFor } from '@raven/native/testing'

import {
  DOWNLOAD_KINDS,
  DOWNLOAD_STATES,
  DOWNLOAD_WAYS,
  type DownloadEntry,
  type DownloadGroup,
  type DownloadLibrary,
  type DownloadStatus,
  GROUP_KINDS,
  downloadKeyOf,
  keyOfEntry,
} from '@/downloads/downloadEntries'
import { AIRBAG, OK_COMPUTER } from '@/test/musicServer'

/** The server every fixture download is from. */
export const DOWNLOADS_SERVER_ID = 'raven'

/** A show's first season, with no library recorded. */
export const SEASON_GROUP: DownloadGroup = {
  kind: GROUP_KINDS.show,
  id: 2,
  title: 'Lucky',
  season: 1,
  library: null,
}

/** OK Computer, with no library recorded. */
export const ALBUM_GROUP: DownloadGroup = {
  kind: GROUP_KINDS.album,
  id: OK_COMPUTER.id,
  title: OK_COMPUTER.title,
  season: null,
  library: null,
}

/** An open library. */
export const SERIES_LIBRARY: DownloadLibrary = {
  id: 7,
  name: 'Series',
  icon: 'tv',
  isLocked: false,
}

/** A library behind the PIN. */
export const VAULT_LIBRARY: DownloadLibrary = { id: 9, name: 'Adult', icon: 'film', isLocked: true }

/** A finished download of 2 GB. */
export const DONE_STATUS: DownloadStatus = { state: DOWNLOAD_STATES.done, bytes: 2_000_000_000 }

type VideoEntryOfProps = {
  id: number
  status: DownloadStatus
  order?: number
  addedAt?: number
  group?: DownloadGroup
  place?: number
}

/** Episode `id` of the season, with a poster saved beside the first. */
export const videoEntryOf = ({
  id,
  status,
  order = id,
  addedAt = 1,
  group = SEASON_GROUP,
  place = id,
}: VideoEntryOfProps): DownloadEntry => ({
  kind: DOWNLOAD_KINDS.video,
  serverId: DOWNLOADS_SERVER_ID,
  mediaId: id,
  title: `Episode ${id}`,
  line: `S01E0${id}`,
  group,
  order,
  way: DOWNLOAD_WAYS.file,
  path: `downloads/raven/${id}/media.mp4`,
  artUri: null,
  artPath: id === 1 ? 'downloads/raven/1/art.jpg' : null,
  logoUri: null,
  logoPath: null,
  status,
  addedAt,
  stamp: id,
  place,
  media: mediaItemFor({ id }),
  tracks: null,
})

type TrackEntryOfProps = { track: typeof AIRBAG; addedAt: number }

/** A finished track of the album, 30 MB, with its cover beside it. */
export const trackEntryOf = ({ track, addedAt }: TrackEntryOfProps): DownloadEntry => ({
  kind: DOWNLOAD_KINDS.track,
  serverId: DOWNLOADS_SERVER_ID,
  mediaId: track.id,
  title: track.title,
  line: 'Radiohead',
  group: ALBUM_GROUP,
  order: track.number ?? 0,
  way: DOWNLOAD_WAYS.file,
  path: `downloads/raven/${track.id}/media.flac`,
  artUri: null,
  artPath: `downloads/raven/${track.id}/art.jpg`,
  logoUri: null,
  logoPath: null,
  status: { state: DOWNLOAD_STATES.done, bytes: 30_000_000 },
  addedAt,
  stamp: 1,
  place: track.id,
  track,
  kbps: null,
})

/** The entries by key, as the store holds them. */
export const recordOf = (entries: readonly DownloadEntry[]) =>
  Object.fromEntries(entries.map((entry) => [keyOfEntry(entry), entry]))

export const downloadKeyFor = (mediaId: number) =>
  downloadKeyOf({ serverId: DOWNLOADS_SERVER_ID, mediaId })
