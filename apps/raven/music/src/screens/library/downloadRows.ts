import { type Track, artistNames, playlistFactsOf } from '@raven/core'
import { BROWSE_KINDS, type BrowseTarget, browseIdOf } from '@raven/native/headless'

import { type DownloadsValues, downloadKeyOf, usedBytesOf } from '@/downloads/downloadStore'
import { downloadedLibraryOf } from '@/downloads/downloadViews'
import { countsLineOf, factsLineOf } from '@/ui/counts'
import { COUNTS_COPY } from '@/ui/copy'

/** One downloaded album or playlist as its row shows it, and what it plays. */
export type DownloadedRow = {
  key: string
  title: string
  line: string
  /** The bytes its tracks take on the device. */
  bytes: number
  target: BrowseTarget
  tracks: readonly Track[]
  /** The cover saved with it, or null. */
  artworkUri: string | null
}

type DownloadRowsOfProps = Pick<DownloadsValues, 'entries' | 'playlists'> & {
  serverId: string
  /** The `file://` address a download's path is at now. */
  uriOf: (path: string) => string
}

type AlbumLineOfProps = { artists: string; done: number; total: number }

/** "Sia · 1 track", or "Sia · 1 of 20 tracks" for an album downloaded in part. */
const albumLineOf = ({ artists, done, total }: AlbumLineOfProps): string =>
  factsLineOf([
    artists,
    done < total ? COUNTS_COPY.partOf({ done, total }) : countsLineOf({ tracks: done }),
  ])

type RowOfProps = {
  target: BrowseTarget
  title: string
  lineOf: (tracks: readonly Track[]) => string
}

/**
 * Library's Downloads, read from the device alone: the albums, then the playlists, downloaded
 * from `serverId`, each with its finished tracks, what they take and the cover saved with them.
 */
export const downloadRowsOf = ({
  entries,
  playlists,
  serverId,
  uriOf,
}: DownloadRowsOfProps): DownloadedRow[] => {
  const library = downloadedLibraryOf({ entries, playlists, serverId, uriOf })
  const bytesOf = (tracks: readonly Track[]): number =>
    tracks.reduce(
      (sum, track) => sum + (entries[downloadKeyOf({ serverId, id: track.id })]?.bytes ?? 0),
      0,
    )
  const rowOf = ({ target, title, lineOf }: RowOfProps): DownloadedRow => {
    const tracks = library.tracksOf(target)
    return {
      key: browseIdOf(target),
      title,
      line: lineOf(tracks),
      bytes: bytesOf(tracks),
      target,
      tracks,
      artworkUri: library.artworkOf(target),
    }
  }
  return [
    ...library.albums().map((album) =>
      rowOf({
        target: { kind: BROWSE_KINDS.album, albumId: album.id },
        title: album.title,
        lineOf: (tracks) =>
          albumLineOf({
            artists: artistNames(album),
            done: tracks.length,
            total: Math.max(album.trackCount, tracks.length),
          }),
      }),
    ),
    ...library.playlists().map((playlist) =>
      rowOf({
        target: { kind: BROWSE_KINDS.playlist, playlistId: playlist.id },
        title: playlist.name,
        lineOf: () => playlistFactsOf({ playlist }),
      }),
    ),
  ]
}

/** Every downloaded track once, in the rows' order, for Play and Shuffle. */
export const allTracksOf = (rows: readonly DownloadedRow[]): Track[] => [
  ...new Map(
    rows.flatMap(({ tracks }) => tracks.map((track) => [track.id, track] as const)),
  ).values(),
]

type DownloadsSummary = { albums: number; playlists: number; bytes: number }

type DownloadsSummaryOfProps = Pick<DownloadsValues, 'entries' | 'playlists'> & { serverId: string }

/** How much is downloaded from `serverId`: its albums, its playlists and the bytes they take. */
export const downloadsSummaryOf = ({
  entries,
  playlists,
  serverId,
}: DownloadsSummaryOfProps): DownloadsSummary => {
  const library = downloadedLibraryOf({ entries, playlists, serverId, uriOf: (path) => path })
  const own = Object.fromEntries(
    Object.entries(entries).filter(([, entry]) => entry.serverId === serverId),
  )
  return {
    albums: library.albums().length,
    playlists: library.playlists().length,
    bytes: usedBytesOf(own),
  }
}
