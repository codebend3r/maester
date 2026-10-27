import { isAbsolute, relative, sep } from 'node:path'
import { DESKTOP_REPLIES, type DesktopReply, DOWNLOAD_STATUS_KINDS, isOpaqueId } from '@raven/core'
import { DOWNLOAD_MESSAGES } from '@/main/downloads/downloadMessages'
import {
  entryById,
  entryByMedia,
  forgetServerPosition,
  notePending,
  noteWatched,
  oweOtherAccounts,
  sameGroup,
  sortDownloads,
  type DownloadEntry,
  type DownloadsState,
} from '@/main/downloads/downloadState'
import type { DownloadsStore } from '@/main/downloads/downloadStore'
import { downloadsDirFor, sidecarPathFor, videoPathFor } from '@/main/downloads/space'
import type { GrantedFile, Grants } from '@/main/grants'
import { errorText } from '@/main/log/errorText'
import type { LocalSidecar } from '@/main/player/playerService'
import { refused } from '@/main/replies'
import {
  type FileFacts,
  forgetResume,
  type PlayerState,
  RECENT_KINDS,
  removeRecent,
  resumeFor,
  watchedShare,
} from '@/main/playerState'
import { loggable } from '@/main/servers/serverCalls'
import type { StateStore } from '@/main/stateStore'
import { MAX_QUEUE } from '@/shared/hostNames'

type OnNotedProps = { downloadId: string }

type AccountIdOfProps = { serverId: string }

type LastAccountIdOfProps = { serverId: string }

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
  /** The server's name, or '' for a server Raven no longer plays from. */
  serverNameOf: (serverId: string) => string
  change: (apply: (state: DownloadsState) => DownloadsState) => void
  /** Tells the page the list changed when only a share watched did. */
  announce: () => void
  /** A position was recorded as pending for this download, so the server is owed it. */
  onNoted: (input: OnNotedProps) => void
  /** The player left the download it was on, for another file or for nothing of this computer's. */
  onLeft: () => void
  /**
   * The account signed in to a server, as the page's session names it; null when none is, and
   * for a server Raven no longer reaches, whose downloads owe it nothing.
   */
  accountIdOf: (input: AccountIdOfProps) => string | null
  /**
   * The last account the page signed in to a server with, kept past a sign out and a relaunch;
   * null until one has, and for a server Raven no longer reaches.
   */
  lastAccountIdOf: (input: LastAccountIdOfProps) => string | null
}

type OpenProps = { downloadId: string }

type OpenTitleProps = { serverId: string; mediaId: number }

type NextOfProps = { fileId: string }

type FromLabelOfProps = { path: string }

type LabelOfProps = { path: string }

type IsStaleDownloadProps = { path: string }

type ServerPositionOfProps = { fileId: string }

type NoteOpenedProps = { fileId: string }

type NotePositionProps = { fileId: string; position: number; duration: number | null }

type NotePlayingProps = { fileId: string | null }

type PlaybackLeftProps = { fileId: string }

type IsWatchedProps = { path: string }

export type DownloadPlayback = {
  /** Plays a ready download as a local file, with its group's later ready files queued. */
  open: (input: OpenProps) => Promise<DesktopReply>
  /**
   * The granted video of a server title's ready download, which playing the title prefers: the
   * page is on it, and the next position noted for it is a play. Null when there is none, or its
   * file has gone.
   */
  openTitle: (input: OpenTitleProps) => Promise<string | null>
  /**
   * The next ready download of a granted download's group, granted, for a play whose queue has
   * run out (opened from On this Mac's recents, or past `MAX_QUEUE`); null after the last, and for any
   * other file.
   */
  nextOf: (input: NextOfProps) => Promise<Readonly<GrantedFile> | null>
  /** The subtitle files kept beside a granted download's video; none for any other file. */
  sidecarsOf: (fileId: string) => readonly LocalSidecar[]
  /**
   * "Downloaded from <server>" for a path in the downloads folder, or "Downloaded" once raven
   * player no longer plays from the server; else null.
   */
  fromLabelOf: (input: FromLabelOfProps) => string | null
  /** The title of the download whose video is at `path`, else null. */
  labelOf: (input: LabelOfProps) => string | null
  /**
   * Whether `path` lies in the downloads folder but is no download's video: a deleted download
   * that a play queue still holds a grant for, since a grant outlives its download.
   */
  isStaleDownload: (input: IsStaleDownloadProps) => boolean
  /**
   * Where the server had a granted download when it was confirmed, for a file with no local
   * resume spot; 0 once a position was noted here, and for any other file.
   */
  serverPositionOf: (input: ServerPositionOfProps) => number
  /**
   * The page opened a granted file: the page is on it, and the next position noted for a
   * download's video is a play.
   */
  noteOpened: (input: NoteOpenedProps) => void
  /** A position saved for a granted file; for a download's video, what the server will hear. */
  notePosition: (input: NotePositionProps) => void
  /**
   * What the engine loaded: a granted file, or nothing of this computer's (a server title, the
   * player hiding for a page with no video).
   */
  notePlaying: (input: NotePlayingProps) => void
  /** The play page left this file; a page already on the next file stays on it. */
  playbackLeft: (input: PlaybackLeftProps) => void
  /** A page said ready: a new page, on no file, though the engine may not have stopped yet. */
  noteNewPage: () => void
  /**
   * Whether the page or the engine is on this download's video, so a deletion waits until
   * both have left it.
   */
  isPlaying: (downloadId: string) => boolean
  /**
   * Whether the player would resume this download partway, short of where it counts as
   * watched: a title scrubbed back from its end is still being watched.
   */
  isMidTitle: (downloadId: string) => boolean
  /**
   * A download's share watched, as On this Mac's recents show one: 1 once it is marked watched,
   * else the share its resume spot gives, null until its file was read. It takes the entry, so
   * the views read every row's share without searching the list for each.
   */
  watchedOf: (entry: DownloadEntry) => number | null
  /** Whether the video at `path` is a download marked watched, which the recents show whole. */
  isWatched: (input: IsWatchedProps) => boolean
  /** Reads these ready downloads' files for their share watched, then tells the page. */
  readFiles: (entries: readonly DownloadEntry[]) => void
  /** The queue's `onRemoved`: what names a removed download goes, its recent and resume spot too. */
  forget: (entries: readonly DownloadEntry[]) => void
}

/** A granted file one side of the player is on, and the download whose video it is, if any. */
type Slot = { fileId: string | null; downloadId: string | null }

const NO_SLOT: Slot = { fileId: null, downloadId: null }

const PLAY_SIDES = { page: 'page', engine: 'engine' } as const

type ForgetVideosProps = { paths: readonly string[] }

/** Drops these videos' recents and resume spots; the same state when it names none of them. */
const forgetVideos = (state: PlayerState, { paths }: ForgetVideosProps): PlayerState => {
  const isNamed = (path: string): boolean =>
    state.recents.some((recent) => recent.kind === RECENT_KINDS.file && recent.path === path) ||
    state.resume.some((spot) => spot.path === path)
  return paths
    .filter(isNamed)
    .reduce(
      (next, path) => forgetResume({ state: removeRecent({ state: next, path }), path }),
      state,
    )
}

// Reaching the end drops the resume spot, so a download marked watched is read whole.
const isMarked = (entry: DownloadEntry | null): boolean =>
  entry !== null && entry.watchedAt !== null

/** The play side of Raven's downloads: a download played as a local file, and what it leaves. */
export const createDownloadPlayback = (deps: DownloadPlaybackDeps): DownloadPlayback => {
  const { store, grants } = deps
  /** Each ready download's video as last read, so the views read its share watched at once. */
  const factsById = new Map<string, FileFacts>()
  /** The download each granted video belongs to, learnt as the files are opened. */
  const downloadIdByFile = new Map<string, string>()
  /** Videos opened and not played yet: the first position noted for one is its play. */
  const freshFiles = new Set<string>()
  /**
   * The account signed in when each video was opened, which every position of that sitting
   * belongs to: a sign in by another account partway through never takes the rest of it.
   */
  const sittings = new Map<string, string | null>()
  /**
   * What the page opened and what the engine loaded, kept apart so neither clears the other:
   * the engine stopping while the page still plays a file, or the page leaving a file the
   * engine still has, leaves the download playing.
   */
  const playing: { page: Slot; engine: Slot } = { page: NO_SLOT, engine: NO_SLOT }

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
      sittings.delete(fileId)
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

  /** The ready downloads after `entry` in its group, in play order. */
  const laterReady = (entry: DownloadEntry): DownloadEntry[] => {
    const group = sortDownloads(store.read().entries).filter((other) =>
      sameGroup({ a: entry, b: other }),
    )
    const index = group.findIndex(({ downloadId }) => downloadId === entry.downloadId)
    return group
      .slice(index + 1)
      .filter((other) => other.status.kind === DOWNLOAD_STATUS_KINDS.ready)
  }

  /** The first of `entries` whose video can still be granted. */
  const firstGranted = async (
    entries: readonly DownloadEntry[],
  ): Promise<Readonly<GrantedFile> | null> => {
    const [first, ...rest] = entries
    if (first === undefined) return null
    const fileId = await grantVideo(first)
    const file = fileId === null ? null : grants.fileOf(fileId)
    return file ?? firstGranted(rest)
  }

  type SittingAccountOfProps = { serverId: string }

  /**
   * The account a sitting belongs to: the one signed in, or while none is, the last that was,
   * so a play before the page sends its session waits for that account rather than going to
   * whoever signs in next. Null only before any account has signed in.
   */
  const sittingAccountOf = ({ serverId }: SittingAccountOfProps): string | null =>
    deps.accountIdOf({ serverId }) ?? deps.lastAccountIdOf({ serverId })

  type SitProps = { fileId: string; entry: DownloadEntry }

  const sit = ({ fileId, entry }: SitProps): void => {
    freshFiles.add(fileId)
    sittings.set(fileId, sittingAccountOf({ serverId: entry.serverId }))
  }

  const open: DownloadPlayback['open'] = async ({ downloadId }) => {
    const entry = entryById(store.read(), { downloadId })
    if (entry === null || entry.status.kind !== DOWNLOAD_STATUS_KINDS.ready)
      return refused(DOWNLOAD_MESSAGES.unknown)
    const later = laterReady(entry).slice(0, MAX_QUEUE)
    const fileId = await grantVideo(entry)
    if (fileId === null) {
      deps.warn(`Raven could not open the file of ${loggable(entry.label)}`)
      return refused(DOWNLOAD_MESSAGES.fileGone)
    }
    sit({ fileId, entry })
    const queued = await Promise.all(
      later.map(async (other) => {
        const queuedId = await grantVideo(other)
        if (queuedId === null) {
          deps.warn(`Raven left ${loggable(other.label)} out of the queue: its file has gone`)
        }
        return queuedId
      }),
    )
    return {
      type: DESKTOP_REPLIES.play,
      target: {
        fileId,
        queue: queued.flatMap((queuedId) => (queuedId === null ? [] : [queuedId])),
      },
    }
  }

  const openTitle: DownloadPlayback['openTitle'] = async ({ serverId, mediaId }) => {
    const entry = entryByMedia(store.read(), { serverId, mediaId })
    if (entry === null || entry.status.kind !== DOWNLOAD_STATUS_KINDS.ready) return null
    const fileId = await grantVideo(entry)
    if (fileId === null) {
      deps.warn(`Raven could not open the file of ${loggable(entry.label)}`)
      return null
    }
    noteOpened({ fileId })
    return fileId
  }

  const nextOf: DownloadPlayback['nextOf'] = async ({ fileId }) => {
    const entry = entryOfFile(fileId)
    return entry === null ? null : firstGranted(laterReady(entry))
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
    return DOWNLOAD_MESSAGES.downloadedFrom(deps.serverNameOf(serverId))
  }

  const isStaleDownload: DownloadPlayback['isStaleDownload'] = ({ path }) => {
    const inside = relative(downloadsDirFor({ userData: deps.userData }), path)
    const isInFolder = inside !== '' && !isAbsolute(inside) && inside.split(sep)[0] !== '..'
    return isInFolder && entryAt(path) === null
  }

  const playingIds = (): (string | null)[] => [playing.page.downloadId, playing.engine.downloadId]

  type PlayProps = { side: keyof typeof playing; fileId: string | null }

  /** Puts one side on a file, or on none, and says so once no side is on a download it was on. */
  const play = ({ side, fileId }: PlayProps): void => {
    const before = playingIds()
    playing[side] = {
      fileId,
      downloadId: fileId === null ? null : (entryOfFile(fileId)?.downloadId ?? null),
    }
    const now = playingIds()
    if (before.some((downloadId) => downloadId !== null && !now.includes(downloadId))) {
      deps.onLeft()
    }
  }

  const noteOpened: DownloadPlayback['noteOpened'] = ({ fileId }) => {
    play({ side: PLAY_SIDES.page, fileId })
    const entry = entryOfFile(fileId)
    if (playing.page.downloadId !== null && entry !== null) sit({ fileId, entry })
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
    const { serverId } = entry
    const signedIn = deps.accountIdOf({ serverId })
    const recorded = sittings.get(fileId)
    const accountId = recorded === undefined ? sittingAccountOf({ serverId }) : recorded
    sittings.set(fileId, accountId)
    deps.change((state) => {
      const local = forgetServerPosition(state, { downloadId })
      // Signed out, the play is this Mac's alone: there is no account to send it under.
      const pending =
        accountId === null
          ? local
          : notePending(local, { downloadId, play: isPlay, position, at, accountId })
      // A sitting that outlived its account's sign in waits in `owed` until that account is back.
      const noted =
        accountId === signedIn
          ? pending
          : oweOtherAccounts(pending, { serverId, accountId: signedIn })
      return noteWatched(noted, { downloadId, position, duration, at })
    })
    deps.onNoted({ downloadId })
  }

  // The page may say it left one file after the next one opened, so only a leave of the file
  // the page is still on clears it.
  const playbackLeft: DownloadPlayback['playbackLeft'] = ({ fileId }) => {
    if (playing.page.fileId === fileId) play({ side: PLAY_SIDES.page, fileId: null })
  }

  const isMidTitle: DownloadPlayback['isMidTitle'] = (downloadId) => {
    const entry = entryById(store.read(), { downloadId })
    if (entry === null) return false
    const state = deps.state.read()
    const path = videoPathOf(entry)
    // The spot's own facts stand in until the file is read, so a launch need not wait for it.
    const file = factsById.get(downloadId) ?? state.resume.find((spot) => spot.path === path)
    if (file === undefined || resumeFor({ state, file }) === 0) return false
    return (watchedShare({ state, file }) ?? 0) < entry.watchedPercent / 100
  }

  const watchedOf: DownloadPlayback['watchedOf'] = (entry) => {
    if (isMarked(entry)) return 1
    const file = factsById.get(entry.downloadId)
    return file === undefined ? null : watchedShare({ state: deps.state.read(), file })
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
      deps.warn(`Raven could not read its downloaded files: ${loggable(errorText(error))}`)
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
      sittings.delete(fileId)
    })
  }

  return {
    open,
    openTitle,
    nextOf,
    sidecarsOf,
    fromLabelOf,
    labelOf: ({ path }) => entryAt(path)?.label ?? null,
    isStaleDownload,
    serverPositionOf: ({ fileId }) => entryOfFile(fileId)?.serverPosition ?? 0,
    noteOpened,
    notePosition,
    notePlaying: ({ fileId }) => play({ side: PLAY_SIDES.engine, fileId }),
    playbackLeft,
    noteNewPage: () => play({ side: PLAY_SIDES.page, fileId: null }),
    isPlaying: (downloadId) => playingIds().includes(downloadId),
    isMidTitle,
    watchedOf,
    isWatched: ({ path }) => isMarked(entryAt(path)),
    readFiles,
    forget,
  }
}
