import { basename, dirname } from 'node:path'
import { type OutputSettings, titleFromFileName } from '@raven/core'
import { type ConfigStore, type DesktopConfig, pickOutput } from '@/main/desktopConfig'
import type { DownloadService } from '@/main/downloads/downloadService'
import { grantNext } from '@/main/folder'
import { GRANT_REFUSALS, type GrantedFile, type GrantRefusal, type Grants } from '@/main/grants'
import {
  addRecent,
  clearRecents,
  type FileFacts,
  noteServerRecent,
  type PlayerState,
  RECENT_KINDS,
  type RecentEntry,
  recentKey,
  removeRecentByKey,
  removeServerRecents,
  resumeFor,
  savePosition,
  setTrackPick,
  trackPickFor,
  watchedShare,
} from '@/main/playerState'
import type { LinkOpener } from '@/main/servers/linkOpener'
import { CALL_MESSAGES, type ServerCalls } from '@/main/servers/serverCalls'
import { cleanName, renameServer, serverById } from '@/main/servers/serverList'
import {
  TRUST_MESSAGES,
  TRUST_OUTCOME_KINDS,
  TRUST_SOURCES,
  type ServerTrust,
  type TrustOutcome,
} from '@/main/servers/serverTrust'
import type { StateStore, Timers } from '@/main/stateStore'
import { UPDATE_COPY, type UpdateService } from '@/main/updateService'
import { serverOriginOf, watchUrlFor } from '@/shared/playLink'
import {
  type AudioDevice,
  type DesktopReply,
  DESKTOP_REQUESTS,
  type DesktopRequest,
  ENVELOPE_KINDS,
  type InvokeEnvelope,
  isInvokeEnvelope,
  MAX_QUEUE,
  type RecentView,
  DESKTOP_REPLIES,
} from '@/shared/protocol'

export const MESSAGES = {
  notVideo: 'raven player opens video files only.',
  missing: 'That file could not be found.',
  nothingDropped: 'Drop a video file to play it.',
  notOpen: 'That video is no longer open. Open it again from Home.',
  unknownRecent: 'That video is no longer in your recents.',
  unknownRequest: 'raven player does not understand that request.',
  failed: 'raven player could not do that. Try again.',
  badServer: TRUST_MESSAGES.invalid,
  badName: 'A server name needs 1 to 80 characters.',
  noBrowser: 'raven player could not open your browser.',
} as const

/** How long Home waits on one file's check: a sleeping network share can block for minutes. */
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
  config: ConfigStore
  serverCalls: Pick<ServerCalls, 'callFromPage'>
  trust: ServerTrust
  links: LinkOpener
  openExternal: (url: string) => Promise<void>
  updates: UpdateService
  downloads: DownloadService
}

export type DesktopService = {
  handle: (envelope: unknown) => Promise<DesktopReply>
  openPaths: (paths: readonly string[]) => Promise<DesktopReply>
  openDialog: () => Promise<DesktopReply>
  /** A batch of links main was handed (`open-url`); the opener acts on the first. */
  openLinks: (links: readonly string[]) => Promise<DesktopReply>
}

const DONE = { type: DESKTOP_REPLIES.done } as const satisfies DesktopReply

const refused = (message: string): DesktopReply => ({ type: 'refused', message })

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

const serversOf = (config: DesktopConfig): DesktopReply => ({
  type: 'servers',
  servers: config.servers.map((server) => ({
    serverId: server.id,
    origin: server.origin,
    name: server.name,
  })),
})

/** What Settings' Add answers once trust has decided. */
const replyForAdd = ({
  outcome,
  config,
}: {
  outcome: TrustOutcome
  config: DesktopConfig
}): DesktopReply => {
  switch (outcome.kind) {
    case TRUST_OUTCOME_KINDS.trusted:
      return serversOf(config)
    case TRUST_OUTCOME_KINDS.declined:
      return DONE
    case TRUST_OUTCOME_KINDS.full:
      return refused(TRUST_MESSAGES.full)
    case TRUST_OUTCOME_KINDS.busy:
      return refused(TRUST_MESSAGES.busy)
    case TRUST_OUTCOME_KINDS.unreachable:
      return refused(TRUST_MESSAGES.unreachable(outcome.origin))
    case TRUST_OUTCOME_KINDS.invalid:
      return refused(MESSAGES.badServer)
    case TRUST_OUTCOME_KINDS.unsaved:
      return refused(TRUST_MESSAGES.unsaved)
    default: {
      const unreachable: never = outcome
      return unreachable
    }
  }
}

export const createDesktopService = (deps: DesktopServiceDeps): DesktopService => {
  const { grants, store, readdir, now, config } = deps
  // Session ids for recents, keyed by `recentKey`, so the page never holds a path or a server's address.
  const idByKey = new Map<string, string>()
  const entryById = new Map<string, RecentEntry>()

  const recentIdFor = ({ entry }: { entry: RecentEntry }): string => {
    const key = recentKey(entry)
    const known = idByKey.get(key)
    const recentId = known ?? deps.newId()
    idByKey.set(key, recentId)
    entryById.set(recentId, entry)
    return recentId
  }

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
      type: 'play',
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

  const nextAfter = async ({
    file,
    queue,
  }: {
    file: GrantedFile
    queue: readonly string[]
  }): Promise<{ fileId: string; label: string; queue: string[] } | null> => {
    const index = queue.findIndex((fileId) => grants.fileOf(fileId) !== null)
    const queued = index === -1 ? null : grants.fileOf(queue[index] ?? '')
    if (queued !== null) {
      return {
        fileId: queued.fileId,
        label: titleFromFileName(queued.name),
        queue: queue.slice(index + 1),
      }
    }
    // GrantedFile keeps only the real path, so a symlinked file's next comes from the folder it really lives in.
    const following = await grantNext({ path: file.path, readdir, grants })
    if (following === null) return null
    return { fileId: following.fileId, label: titleFromFileName(following.name), queue: [] }
  }

  const describeFile = async (
    request: Extract<DesktopRequest, { type: typeof DESKTOP_REQUESTS.describeFile }>,
  ): Promise<DesktopReply> => {
    const file = grants.fileOf(request.fileId)
    if (file === null) return refused(MESSAGES.notOpen)
    store.update((state) => addRecent({ state, path: file.path, at: now() }))
    deps.addRecentDocument(file.path)
    return {
      type: 'file',
      file: {
        fileId: file.fileId,
        label: titleFromFileName(file.name),
        folder: basename(dirname(file.path)),
        resumeAt: resumeFor({ state: store.read(), file }),
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
    const check = deps
      .stat(path)
      .then(
        ({ size, mtimeMs }): FileFacts | null => ({ path, size, mtimeMs }),
        () => null,
      )
      .finally(() => checking.delete(path))
    checking.set(path, check)
    return check
  }

  const factsWithin = (path: string): Promise<FileFacts | null> => {
    const timeout = Promise.withResolvers<null>()
    const timer = deps.timers.set({ run: () => timeout.resolve(null), ms: RECENT_CHECK_MS })
    return Promise.race([factsOf(path), timeout.promise]).finally(() => deps.timers.clear(timer))
  }

  // Home's bar must agree with where playback starts, so a file replaced on disk shows none.
  // Only a file with a saved position needs the check; the rest are not started either way.
  const shareOf = async ({ state, path }: { state: PlayerState; path: string }) => {
    if (!state.resume.some((entry) => entry.path === path)) return null
    const file = await factsWithin(path)
    if (file === null) return null
    return watchedShare({ state, file })
  }

  const viewOf = async ({
    state,
    entry,
  }: {
    state: PlayerState
    entry: RecentEntry
  }): Promise<RecentView | null> => {
    switch (entry.kind) {
      case RECENT_KINDS.file:
        return {
          recentId: recentIdFor({ entry }),
          label: titleFromFileName(basename(entry.path)),
          from: basename(dirname(entry.path)),
          watched: await shareOf({ state, path: entry.path }),
        }
      case RECENT_KINDS.server: {
        // A title whose server has gone cannot be played, so Home does not offer it.
        const server = serverById({ config: config.read(), serverId: entry.serverId })
        if (server === null) return null
        return {
          recentId: recentIdFor({ entry }),
          label: entry.label,
          from: server.name,
          watched: entry.watched,
        }
      }
      default: {
        const unreachable: never = entry
        return unreachable
      }
    }
  }

  const listRecents = async (): Promise<DesktopReply> => {
    const state = store.read()
    const views = await Promise.all(state.recents.map((entry) => viewOf({ state, entry })))
    return {
      type: 'recents',
      recents: views.filter((view): view is RecentView => view !== null),
    }
  }

  const forgetRecentIds = ({ keys }: { keys: readonly string[] }): void => {
    keys.forEach((key) => {
      const recentId = idByKey.get(key)
      idByKey.delete(key)
      if (recentId !== undefined) entryById.delete(recentId)
    })
  }

  const playServer = ({
    serverId,
    mediaId,
  }: {
    serverId: string
    mediaId: number
  }): DesktopReply => {
    if (serverById({ config: config.read(), serverId }) === null) {
      return refused(CALL_MESSAGES.unknownServer)
    }
    // The server keeps where to resume, so a recent starts at 0 and the page asks it.
    return { type: 'playServer', target: { serverId, mediaId, at: 0, next: [] } }
  }

  const openRecent = async ({ recentId }: { recentId: string }): Promise<DesktopReply> => {
    const entry = entryById.get(recentId)
    if (entry === undefined) return refused(MESSAGES.unknownRecent)
    switch (entry.kind) {
      case RECENT_KINDS.file: {
        const result = await grants.grant(entry.path)
        if (!result.ok) return refused(messageFor(result.reason))
        return { type: 'play', target: { fileId: result.file.fileId, queue: [] } }
      }
      case RECENT_KINDS.server:
        return playServer({ serverId: entry.serverId, mediaId: entry.mediaId })
      default: {
        const unreachable: never = entry
        return unreachable
      }
    }
  }

  const dropRecent = ({ recentId }: { recentId: string }): DesktopReply => {
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

  const serverCall = async (
    request: Extract<DesktopRequest, { type: typeof DESKTOP_REQUESTS.serverCall }>,
  ): Promise<DesktopReply> => {
    const result = await deps.serverCalls.callFromPage({
      serverId: request.serverId,
      method: request.method,
      path: request.path,
      body: request.body,
    })
    if (!result.ok) return { type: 'serverUnreachable', message: result.message }
    return { type: 'serverReply', status: result.status, body: result.body }
  }

  const addServer = async ({ origin: address }: { origin: string }): Promise<DesktopReply> => {
    const origin = serverOriginOf(address)
    if (origin === null) return refused(MESSAGES.badServer)
    const outcome = await deps.trust.trust({ origin, from: TRUST_SOURCES.app })
    return replyForAdd({ outcome, config: config.read() })
  }

  const renameOne = ({ serverId, name }: { serverId: string; name: string }): DesktopReply => {
    if (cleanName(name) === null) return refused(MESSAGES.badName)
    if (serverById({ config: config.read(), serverId }) === null) {
      return refused(CALL_MESSAGES.unknownServer)
    }
    config.update((current) => renameServer({ config: current, serverId, name }) ?? current)
    return serversOf(config.read())
  }

  const removeOne = async ({ serverId }: { serverId: string }): Promise<DesktopReply> => {
    await deps.trust.remove(serverId)
    // A removal that could not be saved keeps the server, so it keeps its recents too.
    if (serverById({ config: config.read(), serverId }) === null) {
      store.update((state) => removeServerRecents({ state, serverId }))
      forgetRecentIds({
        keys: [...entryById.values()]
          .filter((entry) => entry.kind === RECENT_KINDS.server && entry.serverId === serverId)
          .map(recentKey),
      })
    }
    return serversOf(config.read())
  }

  const openInBrowser = async ({
    serverId,
    mediaId,
  }: {
    serverId: string
    mediaId: number
  }): Promise<DesktopReply> => {
    const server = serverById({ config: config.read(), serverId })
    if (server === null) return refused(CALL_MESSAGES.unknownServer)
    try {
      await deps.openExternal(watchUrlFor({ origin: server.origin, mediaId }))
    } catch (error) {
      deps.onError(error)
      return refused(MESSAGES.noBrowser)
    }
    return DONE
  }

  const noteServerTitle = (
    request: Extract<DesktopRequest, { type: typeof DESKTOP_REQUESTS.noteServerTitle }>,
  ): DesktopReply => {
    const { serverId, mediaId, label, watched } = request
    if (serverById({ config: config.read(), serverId }) === null) {
      return refused(CALL_MESSAGES.unknownServer)
    }
    store.update((state) =>
      noteServerRecent({ state, serverId, mediaId, label, watched, at: now() }),
    )
    return DONE
  }

  const checkForUpdates = async (): Promise<DesktopReply> => {
    await deps.updates.checkNow()
    return { type: 'updates', status: deps.updates.status() }
  }

  const openRelease = async (): Promise<DesktopReply> =>
    (await deps.updates.openRelease()) ? DONE : refused(UPDATE_COPY.noRelease)

  const handleRequest = async (request: DesktopRequest): Promise<DesktopReply> => {
    switch (request.type) {
      case DESKTOP_REQUESTS.ready:
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
      case DESKTOP_REQUESTS.readOutput:
        return { type: 'output', ...(await deps.output.read()) }
      case DESKTOP_REQUESTS.writeOutput:
        await deps.output.write(pickOutput(request.output))
        return DONE
      case DESKTOP_REQUESTS.serverCall:
        return serverCall(request)
      case DESKTOP_REQUESTS.listServers:
        return serversOf(config.read())
      case DESKTOP_REQUESTS.addServer:
        return addServer({ origin: request.origin })
      case DESKTOP_REQUESTS.renameServer:
        return renameOne({ serverId: request.serverId, name: request.name })
      case DESKTOP_REQUESTS.removeServer:
        return removeOne({ serverId: request.serverId })
      case DESKTOP_REQUESTS.openLink:
        return deps.links.open({ link: request.link, from: TRUST_SOURCES.app })
      case DESKTOP_REQUESTS.openInBrowser:
        return openInBrowser({ serverId: request.serverId, mediaId: request.mediaId })
      case DESKTOP_REQUESTS.noteServerTitle:
        return noteServerTitle(request)
      case DESKTOP_REQUESTS.readUpdates:
        return { type: 'updates', status: deps.updates.status() }
      case DESKTOP_REQUESTS.setUpdateCheck:
        return { type: 'updates', status: deps.updates.setEnabled(request.isEnabled) }
      case DESKTOP_REQUESTS.checkForUpdates:
        return checkForUpdates()
      case DESKTOP_REQUESTS.openRelease:
        return openRelease()
      case DESKTOP_REQUESTS.confirmDownload:
        return deps.downloads.confirm({ askId: request.askId, autoDelete: request.autoDelete })
      case DESKTOP_REQUESTS.declineDownload:
        return deps.downloads.decline({ askId: request.askId })
      case DESKTOP_REQUESTS.retryDownloadAsk:
        return deps.downloads.retryAsk({ askId: request.askId })
      case DESKTOP_REQUESTS.listDownloads:
        return deps.downloads.list()
      case DESKTOP_REQUESTS.readSpace:
        return deps.downloads.readSpace()
      case DESKTOP_REQUESTS.setDownloadDefaults:
        return deps.downloads.setDefaults({ autoDelete: request.autoDelete })
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
          autoDelete: request.autoDelete,
        })
      case DESKTOP_REQUESTS.pauseAllDownloads:
        return deps.downloads.pauseAll()
      case DESKTOP_REQUESTS.resumeAllDownloads:
        return deps.downloads.resumeAll()
      case DESKTOP_REQUESTS.deleteAllDownloads:
        return deps.downloads.removeAll()
      case DESKTOP_REQUESTS.showDownloadsFolder:
        return deps.downloads.showFolder()
      // The page may send this already; main refuses it until it can play a download.
      case DESKTOP_REQUESTS.openDownload:
        return refused(MESSAGES.unknownRequest)
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
