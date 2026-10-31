import { basename, dirname } from 'node:path'
import {
  type AudioDevice,
  DESKTOP_REPLIES,
  DESKTOP_REQUESTS,
  type DesktopReply,
  type DesktopRequest,
  ENVELOPE_KINDS,
  type InvokeEnvelope,
  isInvokeEnvelope,
  type OutputSettings,
  type RecentView,
  titleFromFileName,
  type WindowAction,
} from '@raven/core'
import type { PageAccount } from '@/main/accounts/pageAccount'
import { BOUNDED_OUTCOMES, within } from '@/main/bounded'
import { type ConfigStore, pickOutput, serverOf } from '@/main/desktopConfig'
import type { DownloadService } from '@/main/downloads/downloadService'
import { grantNext } from '@/main/folder'
import { GRANT_REFUSALS, type GrantedFile, type GrantRefusal, type Grants } from '@/main/grants'
import {
  addRecent,
  clearRecents,
  type FileFacts,
  type PlayerState,
  readFacts,
  type RecentEntry,
  recentKey,
  removeRecentByKey,
  resumeFor,
  savePosition,
  setTrackPick,
  trackPickFor,
  watchedShare,
} from '@/main/playerState'
import { DONE, refused } from '@/main/replies'
import type { LinkOpener } from '@/main/servers/linkOpener'
import type { ServerTitles } from '@/main/servers/serverTitles'
import type { StateStore, Timers } from '@/main/stateStore'
import { UPDATE_COPY, type UpdateService } from '@/main/updateService'
import { MAX_QUEUE } from '@/shared/hostNames'
import { PLAYER_MESSAGES } from '@/main/player/playerMessages'
import type { WindowResizeMove, WindowResizeStart } from '@/main/windowChrome'

export const MESSAGES = {
  notVideo: 'Raven opens video files only.',
  missing: 'That file could not be found.',
  nothingDropped: 'Drop a video file to play it.',
  notOpen: PLAYER_MESSAGES.notOpen,
  unknownRecent: 'That video is no longer in your recents.',
  unknownRequest: 'Raven does not understand that request.',
  failed: 'Raven could not do that. Try again.',
  badSession: 'Raven could not read that sign in.',
} as const

/** How long the recents wait on one file's check: a sleeping share can block for minutes. */
const RECENT_CHECK_MS = 500

export type DesktopServiceDeps = {
  grants: Grants
  store: StateStore
  readdir: (dir: string) => Promise<string[]>
  showOpenDialog: () => Promise<string[]>
  addRecentDocument: (path: string) => void
  clearRecentDocuments: () => void
  stat: (path: string) => Promise<{ size: number; mtimeMs: number }>
  timers: Timers
  onReady: () => void
  onError: (error: unknown) => void
  newId: () => string
  now: () => number
  output: {
    read: () => Promise<{ output: OutputSettings; devices: AudioDevice[]; isEngineReady: boolean }>
    write: (output: OutputSettings) => Promise<void>
  }
  setWindowButtons: (isVisible: boolean) => void
  controlWindow: (action: WindowAction) => void
  startWindowResize: (start: WindowResizeStart) => void
  moveWindowResize: (move: WindowResizeMove) => void
  config: ConfigStore
  links: LinkOpener
  updates: UpdateService
  downloads: DownloadService
  /** The page's sign in, which main uses for every call to the server. */
  account: Pick<PageAccount, 'set'>
  titles: ServerTitles
}

export type DesktopService = {
  handle: (envelope: unknown) => Promise<DesktopReply>
  openPaths: (paths: readonly string[]) => Promise<DesktopReply>
  openDialog: () => Promise<DesktopReply>
  /** A batch of links main was handed (`open-url`); the opener acts on the first. */
  openLinks: (links: readonly string[]) => Promise<DesktopReply>
}

const messageFor = (reason: GrantRefusal): string => {
  switch (reason) {
    case GRANT_REFUSALS.missing:
      return MESSAGES.missing
    case GRANT_REFUSALS.notAVideo:
    case GRANT_REFUSALS.notAFile:
      return MESSAGES.notVideo
    default: {
      const unreachable: never = reason
      return unreachable
    }
  }
}

export const createDesktopService = (deps: DesktopServiceDeps): DesktopService => {
  const { grants, store, readdir, now, config } = deps
  // Session ids for recents, keyed by `recentKey`, so the page never holds a path or a server's address.
  const idByKey = new Map<string, string>()
  const entryById = new Map<string, RecentEntry>()

  type RecentIdForProps = { entry: RecentEntry }

  const recentIdFor = ({ entry }: RecentIdForProps): string => {
    const key = recentKey(entry)
    const known = idByKey.get(key)
    const recentId = known ?? deps.newId()
    idByKey.set(key, recentId)
    entryById.set(recentId, entry)
    return recentId
  }

  type TitleOfProps = { path: string; name: string }

  // A download is `video.<container>` or `media.<container>` in a folder named by its media id, so its title
  // and its server come from the download service, and any other file names itself.
  const titleOf = ({ path, name }: TitleOfProps): string =>
    deps.downloads.labelOf({ path }) ?? titleFromFileName(name)

  const fromOf = (path: string): string =>
    deps.downloads.fromLabelOf({ path }) ?? basename(dirname(path))

  const openPaths = async (paths: readonly string[]): Promise<DesktopReply> => {
    if (paths.length === 0) return refused(MESSAGES.nothingDropped)
    const results = await Promise.all(paths.slice(0, MAX_QUEUE + 1).map(grants.grant))
    const files = results
      .flatMap((result) => (result.ok ? [result.file] : []))
      .reduce<GrantedFile[]>(
        (unique, file) =>
          unique.some((seen) => seen.fileId === file.fileId) ? unique : [...unique, file],
        [],
      )
    const [first, ...rest] = files
    if (first === undefined) {
      const refusal = results.find((result) => !result.ok)
      return refused(refusal && !refusal.ok ? messageFor(refusal.reason) : MESSAGES.unknownRequest)
    }
    return {
      type: DESKTOP_REPLIES.play,
      target: { fileId: first.fileId, queue: rest.map((file) => file.fileId) },
    }
  }

  const failed = (error: unknown): DesktopReply => {
    deps.onError(error)
    return refused(MESSAGES.failed)
  }

  const openDialog = async (): Promise<DesktopReply> => {
    try {
      const paths = await deps.showOpenDialog()
      if (paths.length === 0) return DONE
      return await openPaths(paths)
    } catch (error) {
      return failed(error)
    }
  }

  type NextAfterProps = {
    file: GrantedFile
    queue: readonly string[]
  }

  const nextAfter = async ({
    file,
    queue,
  }: NextAfterProps): Promise<{ fileId: string; label: string; queue: string[] } | null> => {
    const index = queue.findIndex((fileId) => grants.fileOf(fileId) !== null)
    const queued = index === -1 ? null : grants.fileOf(queue[index] ?? '')
    if (queued !== null) {
      return { fileId: queued.fileId, label: titleOf(queued), queue: queue.slice(index + 1) }
    }
    // A download's next is the rest of its group, each in a folder of its own. GrantedFile keeps
    // only the real path, so a symlinked file's next comes from the folder it really lives in.
    const following =
      (await deps.downloads.nextOf({ fileId: file.fileId })) ??
      (await grantNext({ path: file.path, readdir, grants }))
    if (following === null) return null
    return { fileId: following.fileId, label: titleOf(following), queue: [] }
  }

  const describeFile = async (
    request: Extract<DesktopRequest, { type: typeof DESKTOP_REQUESTS.describeFile }>,
  ): Promise<DesktopReply> => {
    const file = grants.fileOf(request.fileId)
    if (file === null) return refused(MESSAGES.notOpen)
    // A grant outlives its download, so a play queue can reach a deleted one: it is missing,
    // and must not rejoin On this Mac's recents before its load fails.
    if (deps.downloads.isStaleDownload({ path: file.path })) return refused(MESSAGES.missing)
    store.update((state) => addRecent({ state, path: file.path, at: now() }))
    // A download's file is `mediaPathFor`'s, in a folder named by its media id, and stays listed
    // after a delete, so File > Open Recent leaves it to On this Mac's recents.
    if (deps.downloads.labelOf({ path: file.path }) === null) deps.addRecentDocument(file.path)
    // The page describes a file each time it opens one, so this is where a play begins.
    deps.downloads.noteOpened({ fileId: file.fileId })
    const downloadedFrom = deps.downloads.fromLabelOf({ path: file.path })
    return {
      type: DESKTOP_REPLIES.file,
      file: {
        fileId: file.fileId,
        label: titleOf(file),
        folder: downloadedFrom ?? basename(dirname(file.path)),
        isDownload: downloadedFrom !== null,
        resumeAt: resumeFor({
          state: store.read(),
          file,
          fallback: deps.downloads.serverPositionOf({ fileId: file.fileId }),
        }),
        next: await nextAfter({ file, queue: request.queue }),
        tracks: trackPickFor({ state: store.read(), path: file.path }),
      },
    }
  }

  const recordPosition = (
    request: Extract<DesktopRequest, { type: typeof DESKTOP_REQUESTS.savePosition }>,
  ): DesktopReply => {
    const file = grants.fileOf(request.fileId)
    if (file === null) return refused(MESSAGES.notOpen)
    store.update((state) =>
      savePosition({
        state,
        file: { path: file.path, size: file.size, mtimeMs: file.mtimeMs },
        position: request.position,
        duration: request.duration,
        at: now(),
      }),
    )
    deps.downloads.notePosition({
      fileId: file.fileId,
      position: request.position,
      duration: request.duration,
    })
    return DONE
  }

  const saveTracks = (
    request: Extract<DesktopRequest, { type: typeof DESKTOP_REQUESTS.saveTracks }>,
  ): DesktopReply => {
    const file = grants.fileOf(request.fileId)
    if (file === null) return refused(MESSAGES.notOpen)
    store.update((state) =>
      setTrackPick({
        state,
        path: file.path,
        audio: request.audio,
        subtitle: request.subtitle,
        at: now(),
      }),
    )
    return DONE
  }

  // One check per path at a time: a stuck one is reused, not joined by more stuck threads.
  const checking = new Map<string, Promise<FileFacts | null>>()

  const factsOf = (path: string): Promise<FileFacts | null> => {
    const pending = checking.get(path)
    if (pending !== undefined) return pending
    const check = readFacts({ stat: deps.stat, path }).finally(() => checking.delete(path))
    checking.set(path, check)
    return check
  }

  const factsWithin = async (path: string): Promise<FileFacts | null> => {
    const bounded = await within({ task: factsOf(path), ms: RECENT_CHECK_MS, timers: deps.timers })
    return bounded.outcome === BOUNDED_OUTCOMES.answered ? bounded.result : null
  }

  type ShareOfProps = { state: PlayerState; path: string }

  // A recent's bar must agree with where playback starts, so a file replaced on disk shows none.
  // Only a file with a saved position needs the check; the rest are not started either way.
  const shareOf = async ({ state, path }: ShareOfProps) => {
    if (!state.resume.some((entry) => entry.path === path)) return null
    const file = await factsWithin(path)
    if (file === null) return null
    return watchedShare({ state, file })
  }

  type ViewOfProps = {
    state: PlayerState
    entry: RecentEntry
  }

  const viewOf = async ({ state, entry }: ViewOfProps): Promise<RecentView> => ({
    recentId: recentIdFor({ entry }),
    label: titleOf({ path: entry.path, name: basename(entry.path) }),
    from: fromOf(entry.path),
    watched: deps.downloads.isWatched({ path: entry.path })
      ? 1
      : await shareOf({ state, path: entry.path }),
  })

  const listRecents = async (): Promise<DesktopReply> => {
    const state = store.read()
    return {
      type: DESKTOP_REPLIES.recents,
      recents: await Promise.all(state.recents.map((entry) => viewOf({ state, entry }))),
    }
  }

  type ForgetRecentIdsProps = { keys: readonly string[] }

  const forgetRecentIds = ({ keys }: ForgetRecentIdsProps): void => {
    keys.forEach((key) => {
      const recentId = idByKey.get(key)
      idByKey.delete(key)
      if (recentId !== undefined) entryById.delete(recentId)
    })
  }

  type OpenRecentProps = { recentId: string }

  const openRecent = async ({ recentId }: OpenRecentProps): Promise<DesktopReply> => {
    const entry = entryById.get(recentId)
    if (entry === undefined) return refused(MESSAGES.unknownRecent)
    const result = await grants.grant(entry.path)
    if (!result.ok) return refused(messageFor(result.reason))
    return { type: DESKTOP_REPLIES.play, target: { fileId: result.file.fileId, queue: [] } }
  }

  type DropRecentProps = { recentId: string }

  const dropRecent = ({ recentId }: DropRecentProps): DesktopReply => {
    const entry = entryById.get(recentId)
    if (entry === undefined) return DONE
    const key = recentKey(entry)
    store.update((state) => removeRecentByKey({ state, key }))
    forgetRecentIds({ keys: [key] })
    return DONE
  }

  const dropAllRecents = (): DesktopReply => {
    store.update(clearRecents)
    forgetRecentIds({ keys: [...idByKey.keys()] })
    deps.clearRecentDocuments()
    return DONE
  }

  const checkForUpdates = async (): Promise<DesktopReply> => {
    await deps.updates.checkNow()
    return { type: DESKTOP_REPLIES.updates, status: deps.updates.status() }
  }

  const openRelease = async (): Promise<DesktopReply> =>
    (await deps.updates.openRelease()) ? DONE : refused(UPDATE_COPY.noRelease)

  const handleRequest = async (request: DesktopRequest): Promise<DesktopReply> => {
    switch (request.type) {
      case DESKTOP_REQUESTS.ready:
        deps.downloads.pageReady()
        deps.onReady()
        return DONE
      case DESKTOP_REQUESTS.openDialog:
        return openDialog()
      case DESKTOP_REQUESTS.describeFile:
        return describeFile(request)
      case DESKTOP_REQUESTS.savePosition:
        return recordPosition(request)
      case DESKTOP_REQUESTS.listRecents:
        return listRecents()
      case DESKTOP_REQUESTS.openRecent:
        return openRecent({ recentId: request.recentId })
      case DESKTOP_REQUESTS.removeRecent:
        return dropRecent({ recentId: request.recentId })
      case DESKTOP_REQUESTS.clearRecents:
        return dropAllRecents()
      case DESKTOP_REQUESTS.saveTracks:
        return saveTracks(request)
      case DESKTOP_REQUESTS.windowButtons:
        deps.setWindowButtons(request.isVisible)
        return DONE
      case DESKTOP_REQUESTS.windowControl:
        deps.controlWindow(request.action)
        return DONE
      case DESKTOP_REQUESTS.startWindowResize:
        deps.startWindowResize({ edge: request.edge, at: { x: request.x, y: request.y } })
        return DONE
      case DESKTOP_REQUESTS.moveWindowResize:
        deps.moveWindowResize({ to: { x: request.x, y: request.y } })
        return DONE
      case DESKTOP_REQUESTS.readOutput:
        return { type: DESKTOP_REPLIES.output, ...(await deps.output.read()) }
      case DESKTOP_REQUESTS.writeOutput:
        await deps.output.write(pickOutput(request.output))
        return DONE
      case DESKTOP_REQUESTS.openLink:
        return deps.links.open({ link: request.link })
      case DESKTOP_REQUESTS.readUpdates:
        return { type: DESKTOP_REPLIES.updates, status: deps.updates.status() }
      case DESKTOP_REQUESTS.setUpdateCheck:
        return { type: DESKTOP_REPLIES.updates, status: deps.updates.setEnabled(request.isEnabled) }
      case DESKTOP_REQUESTS.checkForUpdates:
        return checkForUpdates()
      case DESKTOP_REQUESTS.openRelease:
        return openRelease()
      case DESKTOP_REQUESTS.confirmDownload:
        return deps.downloads.confirm({
          askId: request.askId,
          autoDelete: request.shouldAutoDelete,
        })
      case DESKTOP_REQUESTS.declineDownload:
        return deps.downloads.decline({ askId: request.askId })
      case DESKTOP_REQUESTS.retryDownloadAsk:
        return deps.downloads.retryAsk({ askId: request.askId })
      case DESKTOP_REQUESTS.listDownloads:
        return deps.downloads.list()
      case DESKTOP_REQUESTS.readSpace:
        return deps.downloads.readSpace()
      case DESKTOP_REQUESTS.setDownloadDefaults:
        return deps.downloads.setDefaults({ autoDelete: request.shouldAutoDelete })
      case DESKTOP_REQUESTS.pauseDownload:
        return deps.downloads.pause({ downloadId: request.downloadId })
      case DESKTOP_REQUESTS.resumeDownload:
        return deps.downloads.resume({ downloadId: request.downloadId })
      case DESKTOP_REQUESTS.retryDownload:
        return deps.downloads.retry({ downloadId: request.downloadId })
      case DESKTOP_REQUESTS.deleteDownload:
        return deps.downloads.remove({ downloadId: request.downloadId })
      case DESKTOP_REQUESTS.setDownloadAutoDelete:
        return deps.downloads.setAutoDelete({
          downloadId: request.downloadId,
          autoDelete: request.shouldAutoDelete,
        })
      case DESKTOP_REQUESTS.pauseAllDownloads:
        return deps.downloads.pauseAll()
      case DESKTOP_REQUESTS.resumeAllDownloads:
        return deps.downloads.resumeAll()
      case DESKTOP_REQUESTS.deleteAllDownloads:
        return deps.downloads.removeAll()
      case DESKTOP_REQUESTS.showDownloadsFolder:
        return deps.downloads.showFolder()
      case DESKTOP_REQUESTS.openDownload:
        return deps.downloads.open({ downloadId: request.downloadId })
      case DESKTOP_REQUESTS.playbackLeft:
        deps.downloads.playbackLeft({ fileId: request.fileId })
        return DONE
      case DESKTOP_REQUESTS.accountToken:
        return deps.account.set(request.session) ? DONE : refused(MESSAGES.badSession)
      case DESKTOP_REQUESTS.askDownload:
        return deps.downloads.ask({ serverId: serverOf(config.read()).id, target: request.target })
      case DESKTOP_REQUESTS.playTitle:
        return deps.titles.play({ mediaId: request.mediaId, at: request.at, next: request.next })
      default: {
        const unreachable: never = request
        return unreachable
      }
    }
  }

  const route = (envelope: InvokeEnvelope): Promise<DesktopReply> => {
    switch (envelope.kind) {
      case ENVELOPE_KINDS.page:
        return handleRequest(envelope.request)
      case ENVELOPE_KINDS.drop:
        return openPaths(envelope.paths)
      default: {
        const unreachable: never = envelope
        return unreachable
      }
    }
  }

  const handle = async (envelope: unknown): Promise<DesktopReply> => {
    if (!isInvokeEnvelope(envelope)) return refused(MESSAGES.unknownRequest)
    try {
      return await route(envelope)
    } catch (error) {
      return failed(error)
    }
  }

  const openLinks = async (links: readonly string[]): Promise<DesktopReply> => {
    try {
      return await deps.links.openBatch(links)
    } catch (error) {
      return failed(error)
    }
  }

  return { handle, openPaths, openDialog, openLinks }
}
