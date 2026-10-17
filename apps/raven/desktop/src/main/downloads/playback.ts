import { relative, sep } from 'node:path'
import { DOWNLOAD_MESSAGES } from '@/main/downloads/downloadMessages'
import {
  entryById,
  forgetServerPosition,
  notePending,
  noteWatched,
  sameGroup,
  sortDownloads,
  type DownloadEntry,
  type DownloadsState,
} from '@/main/downloads/downloadState'
import type { DownloadsStore } from '@/main/downloads/downloadStore'
import { downloadsDirFor, sidecarPathFor, videoPathFor } from '@/main/downloads/space'
import type { Grants } from '@/main/grants'
import { errorText } from '@/main/log/errorText'
import type { LocalSidecar } from '@/main/player/playerService'
import {
  type FileFacts,
  forgetResume,
  type PlayerState,
  removeRecent,
  watchedShare,
} from '@/main/playerState'
import { loggable } from '@/main/servers/serverCalls'
import type { StateStore } from '@/main/stateStore'
import { type DesktopReply, isOpaqueId, MAX_QUEUE } from '@/shared/protocol'

export type DownloadPlaybackDeps = {
  /** Read here; every change goes through `change`, so the page hears it. */
  store: DownloadsStore
  userData: string
  /** A download plays as any local file does, through a grant. */
  grants: Grants
  /** The player's state, which holds a download's recent, resume spot and share watched. */
  state: StateStore
  stat: (path: string) => Promise<{ size: number; mtimeMs: number }>
  now: () => number
  warn: (message: string) => void
  /** The server's name now, or '' once raven player no longer keeps it. */
  serverNameOf: (serverId: string) => string
  change: (apply: (state: DownloadsState) => DownloadsState) => void
  /** Tells the page the list changed when only a share watched did. */
  announce: () => void
  /** A position was recorded as pending for this download, so the server is owed it. */
  onNoted: (input: { downloadId: string }) => void
}

export type DownloadPlayback = {
  /** Plays a ready download as a local file, with its group's later ready files queued. */
  open: (input: { downloadId: string }) => Promise<DesktopReply>
  /** The subtitle files kept beside a granted download's video; none for any other file. */
  sidecarsOf: (fileId: string) => readonly LocalSidecar[]
  /** "Downloaded from <server>" for a path in the downloads folder, else null. */
  fromLabelOf: (input: { path: string }) => string | null
  /** The title of the download whose video is at `path`, else null. */
  labelOf: (input: { path: string }) => string | null
  /**
   * Where the server had a granted download when it was confirmed, for a file with no local
   * resume spot; 0 once a position was noted here, and for any other file.
   */
  serverPositionOf: (input: { fileId: string }) => number
  /** The page opened a granted file: the next position noted for a download's video is a play. */
  noteOpened: (input: { fileId: string }) => void
  /** A position saved for a granted file; for a download's video, what the server will hear. */
  notePosition: (input: { fileId: string; position: number; duration: number | null }) => void
  /** What the player loaded: a granted file, or nothing of this computer's (a server title, Home). */
  notePlaying: (input: { fileId: string | null }) => void
  /** A download's share watched, as Home's recents show one; null until its file was read. */
  watchedOf: (downloadId: string) => number | null
  /** Reads these ready downloads' files for their share watched, then tells the page. */
  readFiles: (entries: readonly DownloadEntry[]) => void
  /** The queue's `onRemoved`: what names a removed download goes, its recent and resume spot too. */
  forget: (entries: readonly DownloadEntry[]) => void
}

const refused = (message: string): DesktopReply => ({ type: 'refused', message })

/** Drops these videos' recents and resume spots; the same state when it names none of them. */
const forgetVideos = (state: PlayerState, { paths }: { paths: readonly string[] }): PlayerState => {
  const isNamed = (path: string): boolean =>
    state.recents.some((recent) => recent.kind === 'file' && recent.path === path) ||
    state.resume.some((spot) => spot.path === path)
  return paths
    .filter(isNamed)
    .reduce((next, path) => forgetResume(removeRecent(next, { path }), { path }), state)
}

/** The play side of raven player's downloads: a download played as a local file, and what it leaves. */
export const createDownloadPlayback = (deps: DownloadPlaybackDeps): DownloadPlayback => {
  const { store, grants } = deps
  /** Each ready download's video as last read, so the views read its share watched at once. */
  const factsById = new Map<string, FileFacts>()
  /** The download each granted video belongs to, learnt as the files are opened. */
  const downloadIdByFile = new Map<string, string>()
  /** Videos opened and not played yet: the first position noted for one is its play. */
  const freshFiles = new Set<string>()
  /** The download the player loaded, so a deletion can wait until the player leaves it. */
  const playing: { downloadId: string | null } = { downloadId: null }

  const videoPathOf = ({ serverId, mediaId, container }: DownloadEntry): string =>
    videoPathFor({ userData: deps.userData, serverId, mediaId, container })

  const entryAt = (path: string): DownloadEntry | null =>
    store.read().entries.find((entry) => videoPathOf(entry) === path) ?? null

  /** The download a granted file is the video of; one granted outside `open` is found by its path. */
  const entryOfFile = (fileId: string): DownloadEntry | null => {
    const known = downloadIdByFile.get(fileId)
    if (known !== undefined) {
      const knownEntry = entryById(store.read(), { downloadId: known })
      if (knownEntry !== null) return knownEntry
      // A grant can land after its download was removed, so a stale mapping gives way to the
      // path, where the same title downloaded again lives.
      downloadIdByFile.delete(fileId)
      freshFiles.delete(fileId)
    }
    const file = grants.fileOf(fileId)
    const entry = file === null ? null : entryAt(file.path)
    if (entry !== null) downloadIdByFile.set(fileId, entry.downloadId)
    return entry
  }

  /** Grants a download's video and remembers whose it is; null when the file has gone. */
  const grantVideo = async (entry: DownloadEntry): Promise<string | null> => {
    const result = await grants.grant(videoPathOf(entry))
    if (!result.ok) return null
    downloadIdByFile.set(result.file.fileId, entry.downloadId)
    return result.file.fileId
  }

  const open: DownloadPlayback['open'] = async ({ downloadId }) => {
    const state = store.read()
    const entry = entryById(state, { downloadId })
    if (entry === null || entry.status.kind !== 'ready') return refused(DOWNLOAD_MESSAGES.unknown)
    const group = sortDownloads(state.entries).filter((other) => sameGroup({ a: entry, b: other }))
    const later = group
      .slice(group.indexOf(entry) + 1)
      .filter((other) => other.status.kind === 'ready')
      .slice(0, MAX_QUEUE)
    const fileId = await grantVideo(entry)
    if (fileId === null) {
      deps.warn(`raven player could not open the file of ${loggable(entry.label)}`)
      return refused(DOWNLOAD_MESSAGES.fileGone)
    }
    freshFiles.add(fileId)
    const queued = await Promise.all(
      later.map(async (other) => {
        const queuedId = await grantVideo(other)
        if (queuedId === null) {
          deps.warn(
            `raven player left ${loggable(other.label)} out of the queue: its file has gone`,
          )
        }
        return queuedId
      }),
    )
    return {
      type: 'play',
      target: {
        fileId,
        queue: queued.flatMap((queuedId) => (queuedId === null ? [] : [queuedId])),
      },
    }
  }

  const sidecarsOf: DownloadPlayback['sidecarsOf'] = (fileId) => {
    const entry = entryOfFile(fileId)
    if (entry === null) return []
    const { serverId, mediaId } = entry
    return entry.sidecars.map(({ trackId, title, language }) => ({
      path: sidecarPathFor({ userData: deps.userData, serverId, mediaId, trackId }),
      title,
      language,
    }))
  }

  const fromLabelOf: DownloadPlayback['fromLabelOf'] = ({ path }) => {
    const [serverId = ''] = relative(downloadsDirFor({ userData: deps.userData }), path).split(sep)
    if (!isOpaqueId(serverId)) return null
    const serverName = deps.serverNameOf(serverId)
    return serverName === '' ? null : DOWNLOAD_MESSAGES.downloadedFrom(serverName)
  }

  const noteOpened: DownloadPlayback['noteOpened'] = ({ fileId }) => {
    if (entryOfFile(fileId) !== null) freshFiles.add(fileId)
  }

  const notePosition: DownloadPlayback['notePosition'] = ({ fileId, position, duration }) => {
    const file = grants.fileOf(fileId)
    const entry = entryOfFile(fileId)
    if (file === null || entry === null) return
    const { downloadId } = entry
    // The facts the player state saved this position under, so the next views read its share.
    factsById.set(downloadId, { path: file.path, size: file.size, mtimeMs: file.mtimeMs })
    const isPlay = freshFiles.has(fileId)
    freshFiles.delete(fileId)
    const at = deps.now()
    deps.change((state) =>
      noteWatched(
        notePending(forgetServerPosition(state, { downloadId }), {
          downloadId,
          play: isPlay,
          position,
          at,
        }),
        { downloadId, position, duration, at },
      ),
    )
    deps.onNoted({ downloadId })
  }

  const notePlaying: DownloadPlayback['notePlaying'] = ({ fileId }) => {
    playing.downloadId = fileId === null ? null : (entryOfFile(fileId)?.downloadId ?? null)
  }

  const watchedOf: DownloadPlayback['watchedOf'] = (downloadId) => {
    const file = factsById.get(downloadId)
    return file === undefined ? null : watchedShare(deps.state.read(), { file })
  }

  /** Reads a ready download's file for its share watched; a file that cannot be read shows none. */
  const readFacts = async (entry: DownloadEntry): Promise<boolean> => {
    const path = videoPathOf(entry)
    const facts = await deps.stat(path).then(
      ({ size, mtimeMs }): FileFacts | null => ({ path, size, mtimeMs }),
      () => null,
    )
    // A download removed while its file was read keeps nothing.
    if (facts === null || entryById(store.read(), { downloadId: entry.downloadId }) === null) {
      return false
    }
    factsById.set(entry.downloadId, facts)
    return true
  }

  const readAll = async (entries: readonly DownloadEntry[]): Promise<void> => {
    const read = await Promise.all(entries.map(readFacts))
    if (read.includes(true)) deps.announce()
  }

  const readFiles: DownloadPlayback['readFiles'] = (entries) => {
    readAll(entries).catch((error: unknown) => {
      deps.warn(`raven player could not read its downloaded files: ${loggable(errorText(error))}`)
    })
  }

  const forget: DownloadPlayback['forget'] = (entries) => {
    const removed = new Set(entries.map(({ downloadId }) => downloadId))
    deps.state.update((state) => forgetVideos(state, { paths: entries.map(videoPathOf) }))
    removed.forEach((downloadId) => factsById.delete(downloadId))
    const files = [...downloadIdByFile].filter(([, downloadId]) => removed.has(downloadId))
    files.forEach(([fileId]) => {
      downloadIdByFile.delete(fileId)
      freshFiles.delete(fileId)
    })
  }

  return {
    open,
    sidecarsOf,
    fromLabelOf,
    labelOf: ({ path }) => entryAt(path)?.label ?? null,
    serverPositionOf: ({ fileId }) => entryOfFile(fileId)?.serverPosition ?? 0,
    noteOpened,
    notePosition,
    notePlaying,
    watchedOf,
    readFiles,
    forget,
  }
}
