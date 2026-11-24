import {
  type AudioDevice,
  DESKTOP_REPLIES,
  DESKTOP_REQUESTS,
  type DesktopReply,
  type DesktopRequest,
  isDesktopRequest,
  type OutputSettings,
  type WindowAction,
} from '@raven/core'
import type { PageAccount } from '@/main/accounts/pageAccount'
import { pickOutput } from '@/main/desktopConfig'
import type { DownloadService } from '@/main/downloads/downloadService'
import type { GrantedFile, Grants } from '@/main/grants'
import { resumeFor, savePosition, setTrackPick, trackPickFor } from '@/main/playerState'
import { DONE, refused } from '@/main/replies'
import type { ActiveServer } from '@/main/servers/activeServer'
import type { LinkOpener } from '@/main/servers/linkOpener'
import { DIRECTORY_MESSAGES, type ServerDirectory } from '@/main/servers/serverDirectory'
import type { ServerTitles } from '@/main/servers/serverTitles'
import type { StateStore } from '@/main/stateStore'
import { UPDATE_COPY, type UpdateService } from '@/main/updateService'
import { PLAYER_MESSAGES } from '@/main/player/playerMessages'
import type { WindowResizeMove, WindowResizeStart } from '@/main/windowChrome'

export const MESSAGES = {
  missing: 'That file could not be found.',
  notOpen: PLAYER_MESSAGES.notOpen,
  unknownRequest: 'Raven does not understand that request.',
  failed: 'Raven could not do that. Try again.',
  badSession: 'Raven could not read that sign in.',
} as const

export type DesktopServiceDeps = {
  grants: Grants
  store: StateStore
  onReady: () => void
  onError: (error: unknown) => void
  now: () => number
  output: {
    read: () => Promise<{ output: OutputSettings; devices: AudioDevice[]; isEngineReady: boolean }>
    write: (output: OutputSettings) => Promise<void>
  }
  setWindowButtons: (isVisible: boolean) => void
  controlWindow: (action: WindowAction) => void
  startWindowResize: (start: WindowResizeStart) => void
  moveWindowResize: (move: WindowResizeMove) => void
  links: LinkOpener
  updates: UpdateService
  downloads: DownloadService
  /** The page's sign in, which main uses for every call to the server. */
  account: Pick<PageAccount, 'set'>
  titles: ServerTitles
  /** The server in use, and main's reads of the account's others. */
  servers: Pick<ActiveServer, 'use'> & Pick<ServerDirectory, 'check' | 'librariesOf'>
}

export type DesktopService = {
  handle: (request: unknown) => Promise<DesktopReply>
  /** A batch of links main was handed (`open-url`); the opener acts on the first. */
  openLinks: (links: readonly string[]) => Promise<DesktopReply>
}

export const createDesktopService = (deps: DesktopServiceDeps): DesktopService => {
  const { grants, store, now } = deps

  type Labelled = { fileId: string; label: string }

  /** A granted file under its download's title; null for none, and for one whose download has gone. */
  const labelled = (file: Readonly<GrantedFile> | null): Labelled | null => {
    if (file === null) return null
    const label = deps.downloads.labelOf({ path: file.path })
    return label === null ? null : { fileId: file.fileId, label }
  }

  const failed = (error: unknown): DesktopReply => {
    deps.onError(error)
    return refused(MESSAGES.failed)
  }

  type NextAfterProps = {
    file: GrantedFile
    queue: readonly string[]
  }

  /** What plays after `file`: the first of its queue still downloaded, else the next of its group. */
  const nextAfter = async ({
    file,
    queue,
  }: NextAfterProps): Promise<{ fileId: string; label: string; queue: string[] } | null> => {
    const files = queue.map((fileId) => labelled(grants.fileOf(fileId)))
    const index = files.findIndex((queued) => queued !== null)
    const queued = files[index] ?? null
    if (queued !== null) return { ...queued, queue: queue.slice(index + 1) }
    const following = labelled(await deps.downloads.nextOf({ fileId: file.fileId }))
    return following === null ? null : { ...following, queue: [] }
  }

  const describeFile = async (
    request: Extract<DesktopRequest, { type: typeof DESKTOP_REQUESTS.describeFile }>,
  ): Promise<DesktopReply> => {
    const file = grants.fileOf(request.fileId)
    if (file === null) return refused(MESSAGES.notOpen)
    const label = deps.downloads.labelOf({ path: file.path })
    const downloadedFrom = deps.downloads.fromLabelOf({ path: file.path })
    // A grant outlives its download, so a play queue can reach a deleted one: it is missing.
    if (label === null || downloadedFrom === null) return refused(MESSAGES.missing)
    // The page describes a file each time it opens one, so this is where a play begins.
    deps.downloads.noteOpened({ fileId: file.fileId })
    return {
      type: DESKTOP_REPLIES.file,
      file: {
        fileId: file.fileId,
        label,
        folder: downloadedFrom,
        mediaId: deps.downloads.mediaIdOf({ path: file.path }),
        logo: deps.downloads.logoOf({ path: file.path }),
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

  const checkForUpdates = async (): Promise<DesktopReply> => {
    await deps.updates.checkNow()
    return { type: DESKTOP_REPLIES.updates, status: deps.updates.status() }
  }

  const openRelease = async (): Promise<DesktopReply> =>
    (await deps.updates.openRelease()) ? DONE : refused(UPDATE_COPY.noRelease)

  const checkServer = async (origin: string): Promise<DesktopReply> => {
    const checked = await deps.servers.check(origin)
    if (!checked.ok) return refused(DIRECTORY_MESSAGES.unreachable)
    return { type: DESKTOP_REPLIES.server, serverId: checked.serverId }
  }

  const serverLibraries = async (serverId: string): Promise<DesktopReply> => {
    const libraries = await deps.servers.librariesOf(serverId)
    if (libraries === null) return refused(DIRECTORY_MESSAGES.unreachable)
    return { type: DESKTOP_REPLIES.libraries, libraries }
  }

  const handleRequest = async (request: DesktopRequest): Promise<DesktopReply> => {
    switch (request.type) {
      case DESKTOP_REQUESTS.ready:
        deps.downloads.pageReady()
        deps.onReady()
        return DONE
      case DESKTOP_REQUESTS.describeFile:
        return describeFile(request)
      case DESKTOP_REQUESTS.savePosition:
        return recordPosition(request)
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
        return deps.downloads.ask({ target: request.target })
      case DESKTOP_REQUESTS.playTitle:
        return deps.titles.play({ mediaId: request.mediaId, at: request.at, next: request.next })
      case DESKTOP_REQUESTS.useServer:
        return deps.servers.use(request.serverId)
      case DESKTOP_REQUESTS.checkServer:
        return checkServer(request.origin)
      case DESKTOP_REQUESTS.serverLibraries:
        return serverLibraries(request.serverId)
      default: {
        const unreachable: never = request
        return unreachable
      }
    }
  }

  const handle = async (request: unknown): Promise<DesktopReply> => {
    if (!isDesktopRequest(request)) return refused(MESSAGES.unknownRequest)
    try {
      return await handleRequest(request)
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

  return { handle, openLinks }
}
