import type { Track } from '@raven/core'
import type { TrackPlan } from '@raven/native/headless'

import {
  DOWNLOAD_KINDS,
  type DownloadEntry,
  type VideoEntry,
  downloadKeyOf,
  isDone,
  libraryOfEntry,
} from '@/downloads/downloadEntries'

/** Every download by its key, as the store holds them. */
export type Entries = Readonly<Record<string, DownloadEntry>>

type VisibleEntriesOfProps = {
  entries: Entries
  /** Whether this device holds the server's PIN unlock, which shows the locked libraries' downloads. */
  isUnlocked: boolean
}

type IsVisibleProps = { entry: DownloadEntry; isUnlocked: boolean }

/** A download from a locked library is seen only while the PIN unlock is held. */
const isVisible = ({ entry, isUnlocked }: IsVisibleProps): boolean =>
  isUnlocked || !(libraryOfEntry(entry)?.isLocked ?? false)

/**
 * The downloads a viewer may see now: every one, less those from a library the server locks
 * while this device holds no unlock. What is hidden stays on the device and still counts.
 */
export const visibleEntriesOf = ({ entries, isUnlocked }: VisibleEntriesOfProps): Entries =>
  Object.fromEntries(
    Object.entries(entries).filter(([, entry]) => isVisible({ entry, isUnlocked })),
  )

type DownloadedOfProps = {
  entries: Entries
  serverId: string
  mediaId: number
  isUnlocked: boolean
}

/** The finished download of `mediaId` from `serverId` a viewer may see now, or null. */
const downloadedOf = ({
  entries,
  serverId,
  mediaId,
  isUnlocked,
}: DownloadedOfProps): DownloadEntry | null => {
  const entry = entries[downloadKeyOf({ serverId, mediaId })]
  if (entry === undefined || !isDone(entry)) return null
  return isVisible({ entry, isUnlocked }) ? entry : null
}

/** The finished download of video `mediaId` from `serverId`, or null, as for one hidden by its lock. */
export const downloadedVideoOf = (props: DownloadedOfProps): VideoEntry | null => {
  const entry = downloadedOf(props)
  if (entry === null || entry.kind !== DOWNLOAD_KINDS.video) return null
  return entry
}

/** What the music host reads as each track plays, so a download finished meanwhile is found. */
type TrackPlanReading = {
  entries: Entries
  /** Whether this device holds the server's PIN unlock now. */
  isUnlocked: boolean
  /** The `file://` address a download's path is at now. */
  uriOf: (path: string) => string
}

type TrackPlanForProps = { serverId: string; read: () => TrackPlanReading }

/** What a track plays from before the server's file: its download, with the cover saved beside it. */
export const trackPlanFor = ({ serverId, read }: TrackPlanForProps): TrackPlan => ({
  downloadedOf: (track: Track) => {
    const { entries, isUnlocked, uriOf } = read()
    const entry = downloadedOf({ entries, serverId, mediaId: track.id, isUnlocked })
    if (entry === null || entry.kind !== DOWNLOAD_KINDS.track) return null
    return {
      uri: uriOf(entry.path),
      artworkUri: entry.artPath === null ? null : uriOf(entry.artPath),
    }
  },
  streamKbps: async () => null,
})
