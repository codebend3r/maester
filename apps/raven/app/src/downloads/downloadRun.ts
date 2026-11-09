import {
  DEVICE_DOWNLOAD_STATES,
  type DeviceDownload,
  type MediaTracks,
  PLAYBACK_MODES,
} from '@raven/core'
import type { MediaSources, SourceOutcome } from '@raven/native/headless'

import { DOWNLOAD_COPY } from '@/downloads/copy'
import {
  ART_FILE,
  DOWNLOAD_KINDS,
  DOWNLOAD_STATES,
  DOWNLOAD_WAYS,
  type DownloadEntry,
  type DownloadGroup,
  type EntryChange,
  LOGO_FILE,
  type SettledStatus,
  failedWith,
  folderOfEntry,
  inFolder,
  keyOfEntry,
} from '@/downloads/downloadEntries'
import { IGNORED } from '@/lib/ignore'
import type { DownloadProgressActions, DownloadReading } from '@/stores/downloadProgress'

/** How often a video the server is still copying is asked about again. */
const PREPARE_POLL_MS = 2000

/** What the player or a download fetches: the address and the headers it sends. */
type FetchSource = Extract<SourceOutcome, { ok: true }>['source']

type DiskFetchProps = {
  source: FetchSource
  path: string
  /** Aborted when the download is cancelled. */
  signal: AbortSignal
  onProgress: (reading: DownloadReading) => void
}

/** Where the bytes go: `expo-file-system` on the device, memory in the tests. */
export type DownloadDisk = {
  /** Fetches `source` into a `.part` beside `path`, then moves it there; resolves its bytes. Leaves no file when it fails. */
  fetch: (props: DiskFetchProps) => Promise<number>
  /** The `file://` address `path` is at now. */
  uriOf: (path: string) => string
  exists: (path: string) => boolean
  /** Every download's folder on disk, `downloads/<serverId>/<mediaId>`. */
  folders: () => string[]
  /** Deletes a download's folder and all in it. */
  remove: (folder: string) => Promise<void>
  removeAll: () => Promise<void>
  /** The bytes free on the device; null where it cannot say. */
  freeBytes: () => number | null
}

/** What a download asks of the server it is from. */
export type DownloadServer = {
  sources: Pick<MediaSources, 'source' | 'trackSource' | 'copySource'>
  /** Starts or reads the server's MP4 copy of a video. */
  prepare: (mediaId: number) => Promise<DeviceDownload>
  tracks: (mediaId: number) => Promise<MediaTracks>
  /** The headers a picture's request carries on this server. */
  pictureHeaders: (uri: string) => Promise<Record<string, string>>
  /** A movie's or show's title art, read from the server; null for anything else, or none. */
  titleArtOf: (group: DownloadGroup) => Promise<string | null>
}

export type DownloadDevice = {
  disk: DownloadDisk
  /** The server a download is from, or null when this device no longer holds it. */
  serverOf: (serverId: string) => DownloadServer | null
  now: () => number
  wait: (ms: number) => Promise<void>
}

/** What one download's run reads and writes while it fetches. */
type RunContext = {
  device: DownloadDevice
  server: DownloadServer
  /** The entry as it stands now, or null once it was let go of or queued again. */
  current: () => DownloadEntry | null
  /** Writes `change` onto the entry, unless it was let go of or queued again meanwhile. */
  update: (change: EntryChange) => void
  progress: DownloadProgressActions
  /** Aborted when the download is cancelled. */
  signal: AbortSignal
}

type RunProps = { entry: DownloadEntry; context: RunContext }

/** Where a download's bytes come from: the file, the copy or the transcode, by ticket. */
const sourceOf = ({ entry, context: { server } }: RunProps): Promise<SourceOutcome> => {
  if (entry.kind === DOWNLOAD_KINDS.track) {
    return server.sources.trackSource({ mediaId: entry.mediaId, kbps: entry.kbps })
  }
  if (entry.way === DOWNLOAD_WAYS.copy) return server.sources.copySource(entry.mediaId)
  return server.sources.source({
    media: { id: entry.mediaId },
    mode: PLAYBACK_MODES.direct,
    audio: null,
    burn: null,
  })
}

/** Waits for the server's copy, saying how far along it is; null once it is ready. */
const prepare = async ({ entry, context }: RunProps): Promise<SettledStatus | null> => {
  const answer = await context.server.prepare(entry.mediaId).catch(() => null)
  if (answer === null) return failedWith(DOWNLOAD_COPY.unreachable)
  if (context.current() === null) return failedWith(DOWNLOAD_COPY.failed)
  switch (answer.state) {
    case DEVICE_DOWNLOAD_STATES.ready:
      return null
    case DEVICE_DOWNLOAD_STATES.failed:
      return failedWith(answer.message)
    case DEVICE_DOWNLOAD_STATES.preparing:
      context.update({ status: { state: DOWNLOAD_STATES.preparing, progress: answer.progress } })
      await context.device.wait(PREPARE_POLL_MS)
      return prepare({ entry, context })
    default: {
      const unknown: never = answer
      return unknown
    }
  }
}

type FetchPictureProps = RunProps & { uri: string | null; file: string }

/** A picture's path once saved beside the file, or null; a picture that fails costs the download nothing. */
const fetchPicture = async ({
  entry,
  context: { server, device },
  uri,
  file,
}: FetchPictureProps): Promise<string | null> => {
  if (uri === null) return null
  const path = inFolder({ folder: folderOfEntry(entry), file })
  try {
    const headers = await server.pictureHeaders(uri)
    await device.disk.fetch({
      source: { uri, headers },
      path,
      signal: new AbortController().signal,
      onProgress: IGNORED,
    })
    return path
  } catch {
    return null
  }
}

/**
 * Saves the title art and the poster or cover first, so Downloads shows what is coming while
 * it comes. A download asked for before entries kept their title art reads it from the server.
 */
const keepPictures = async ({ entry, context }: RunProps): Promise<void> => {
  const logoUri =
    entry.logoUri === undefined
      ? await context.server.titleArtOf(entry.group).catch(() => null)
      : entry.logoUri
  const [logoPath, artPath] = await Promise.all([
    fetchPicture({ entry, context, uri: logoUri, file: LOGO_FILE }),
    fetchPicture({ entry, context, uri: entry.artUri, file: ART_FILE }),
  ])
  context.update({ logoUri, logoPath, artPath })
}

/** A video's file's tracks, kept for its pickers offline; none for the copy, or when they cannot be read. */
const keepTracks = async ({ entry, context }: RunProps): Promise<void> => {
  if (entry.kind !== DOWNLOAD_KINDS.video || entry.way !== DOWNLOAD_WAYS.file) return
  const tracks = await context.server.tracks(entry.mediaId).catch(() => null)
  if (tracks !== null) context.update({ tracks })
}

/**
 * One download from start to finish: its pictures, the server's copy where it needs one, the
 * source by ticket, a video's tracks, then the bytes onto the disk, read as they come.
 */
export const fetchOne = async ({ entry, context }: RunProps): Promise<SettledStatus> => {
  const { device, progress, signal } = context
  await keepPictures({ entry, context })
  const preparing = entry.way === DOWNLOAD_WAYS.copy ? await prepare({ entry, context }) : null
  if (preparing !== null) return preparing
  const outcome = await sourceOf({ entry, context })
  if (!outcome.ok) return failedWith(outcome.message)
  await keepTracks({ entry, context })
  context.update({ status: { state: DOWNLOAD_STATES.downloading } })
  const key = keyOfEntry(entry)
  try {
    const bytes = await device.disk.fetch({
      source: outcome.source,
      path: entry.path,
      signal,
      onProgress: ({ bytes: written, total }) =>
        progress.read({ key, bytes: written, total, now: device.now() }),
    })
    return { state: DOWNLOAD_STATES.done, bytes }
  } catch {
    return failedWith(DOWNLOAD_COPY.failed)
  } finally {
    progress.forget({ key })
  }
}
