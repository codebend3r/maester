import type { Track } from '@raven/core'
import { BROWSE_KINDS, type BrowseTarget, type DownloadedLibrary } from '@raven/native/headless'

import {
  DOWNLOAD_SOURCES,
  DOWNLOAD_STATUSES,
  type DownloadCollection,
  type DownloadEntry,
  type DownloadsValues,
  downloadKeyOf,
  isDone,
  isUnderway,
} from '@/downloads/downloadStore'

type DownloadedOfProps = Pick<DownloadsValues, 'entries'> & { serverId: string; mediaId: number }

/** The finished download of `mediaId` from `serverId`, or undefined. */
export const downloadedOf = ({
  entries,
  serverId,
  mediaId,
}: DownloadedOfProps): DownloadEntry | undefined => {
  const entry = entries[downloadKeyOf({ serverId, id: mediaId })]
  return entry !== undefined && isDone(entry) ? entry : undefined
}

const byDiscAndNumber = (a: Track, b: Track): number =>
  a.disc === b.disc ? (a.number ?? 0) - (b.number ?? 0) : a.disc - b.disc

type DownloadedLibraryOfProps = Pick<DownloadsValues, 'entries' | 'playlists'> & {
  serverId: string
  /** The `file://` address a download's path is at now. */
  uriOf: (path: string) => string
}

/**
 * What is downloaded from `serverId`, as CarPlay, Android Auto and the Downloads list read it:
 * the albums by title, the playlists by name, a target's finished tracks in order, and the
 * cover saved with them.
 */
export const downloadedLibraryOf = ({
  entries,
  playlists,
  serverId,
  uriOf,
}: DownloadedLibraryOfProps): DownloadedLibrary => {
  const done = Object.values(entries).filter(
    (entry) => entry.serverId === serverId && isDone(entry),
  )
  const playlistOf = (playlistId: number) => playlists[downloadKeyOf({ serverId, id: playlistId })]
  const entriesOf = (target: BrowseTarget): DownloadEntry[] => {
    switch (target.kind) {
      case BROWSE_KINDS.album:
        return done
          .filter(({ album }) => (album?.id ?? null) === target.albumId)
          .toSorted((a, b) => byDiscAndNumber(a.track, b.track))
      case BROWSE_KINDS.playlist:
        return (playlistOf(target.playlistId)?.mediaIds ?? []).flatMap((mediaId) => {
          const entry = downloadedOf({ entries, serverId, mediaId })
          return entry === undefined ? [] : [entry]
        })
      case BROWSE_KINDS.track: {
        const entry = downloadedOf({ entries, serverId, mediaId: target.mediaId })
        return entry === undefined ? [] : [entry]
      }
      default: {
        const unknown: never = target
        return unknown
      }
    }
  }
  const tracksOf = (target: BrowseTarget): Track[] => entriesOf(target).map(({ track }) => track)
  return {
    albums: () =>
      [
        ...new Map(
          done.flatMap(({ album }) => (album === null ? [] : [[album.id, album] as const])),
        ).values(),
      ].toSorted((a, b) => a.sortTitle.localeCompare(b.sortTitle)),
    playlists: () =>
      Object.values(playlists)
        .filter((each) => each.serverId === serverId)
        .filter(
          ({ playlist }) =>
            tracksOf({ kind: BROWSE_KINDS.playlist, playlistId: playlist.id }).length > 0,
        )
        .map(({ playlist }) => playlist)
        .toSorted((a, b) => a.name.localeCompare(b.name)),
    tracksOf,
    artworkOf: (target) => {
      const coverPath =
        entriesOf(target).find((entry) => entry.coverPath !== null)?.coverPath ?? null
      return coverPath === null ? null : uriOf(coverPath)
    },
  }
}

/** How far an album's or a playlist's tracks have downloaded, as its button shows it. */
export const DOWNLOAD_PROGRESS = {
  none: 'none',
  downloading: 'downloading',
  done: 'done',
  failed: 'failed',
} as const

type DownloadProgress = {
  kind: (typeof DOWNLOAD_PROGRESS)[keyof typeof DOWNLOAD_PROGRESS]
  done: number
  total: number
}

type DownloadProgressOfProps = Pick<DownloadsValues, 'entries' | 'playlists'> & {
  serverId: string
  mediaIds: readonly number[]
  collection: DownloadCollection
}

type HeldEntryOfProps = Omit<DownloadProgressOfProps, 'mediaIds'>

/** A track's entry, when the collection itself holds it: a track another download holds does not count. */
const heldEntryOf = ({ entries, playlists, serverId, collection }: HeldEntryOfProps) => {
  switch (collection.kind) {
    case DOWNLOAD_SOURCES.album:
      return (id: number): DownloadEntry[] => {
        const entry = entries[downloadKeyOf({ serverId, id })]
        if (entry === undefined) return []
        return (entry.album?.id ?? null) === collection.album.id ? [entry] : []
      }
    case DOWNLOAD_SOURCES.playlist: {
      const saved = playlists[downloadKeyOf({ serverId, id: collection.playlist.id })]
      return (id: number): DownloadEntry[] => {
        const entry = entries[downloadKeyOf({ serverId, id })]
        return entry !== undefined && (saved?.mediaIds.includes(id) ?? false) ? [entry] : []
      }
    }
    default: {
      const unknown: never = collection
      return unknown
    }
  }
}

/**
 * Whether an album's or a playlist's tracks are downloading, all done, failed in part, or not
 * (or not all) downloaded, counting only the tracks it was downloaded for: an album whose
 * tracks a playlist brought reads Download until the album itself is.
 */
export const downloadProgressOf = ({
  mediaIds,
  ...props
}: DownloadProgressOfProps): DownloadProgress => {
  const held = mediaIds.flatMap(heldEntryOf(props))
  const done = held.filter(isDone).length
  const total = mediaIds.length
  if (held.some(isUnderway)) return { kind: DOWNLOAD_PROGRESS.downloading, done, total }
  if (held.some(({ status }) => status === DOWNLOAD_STATUSES.failed)) {
    return { kind: DOWNLOAD_PROGRESS.failed, done, total }
  }
  return {
    kind: total > 0 && done === total ? DOWNLOAD_PROGRESS.done : DOWNLOAD_PROGRESS.none,
    done,
    total,
  }
}
