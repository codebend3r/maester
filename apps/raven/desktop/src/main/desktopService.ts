import { basename, dirname } from 'node:path'
import { titleFromFileName } from '@raven/core'
import { grantNext } from '@/main/folder'
import type { GrantedFile, GrantRefusal, Grants } from '@/main/grants'
import {
  addRecent,
  clearRecents,
  removeRecent,
  resumeFor,
  savePosition,
  watchedShare,
} from '@/main/playerState'
import type { StateStore } from '@/main/stateStore'
import {
  type DesktopReply,
  type DesktopRequest,
  isInvokeEnvelope,
  MAX_QUEUE,
} from '@/shared/protocol'

export const MESSAGES = {
  notVideo: 'raven player opens video files only.',
  missing: 'That file could not be found.',
  nothingDropped: 'Drop a video file to play it.',
  notOpen: 'That video is no longer open. Open it again from Home.',
  unknownRecent: 'That video is no longer in your recents.',
  unknownRequest: 'raven player does not understand that request.',
} as const

export type DesktopServiceDeps = {
  grants: Grants
  store: StateStore
  readdir: (dir: string) => Promise<string[]>
  showOpenDialog: () => Promise<string[]>
  addRecentDocument: (path: string) => void
  clearRecentDocuments: () => void
  onReady: () => void
  newId: () => string
  now: () => number
}

export type DesktopService = {
  handle: (envelope: unknown) => Promise<DesktopReply>
  openPaths: (paths: readonly string[]) => Promise<DesktopReply>
  openDialog: () => Promise<DesktopReply>
}

const DONE = { type: 'done' } as const satisfies DesktopReply

const refused = (message: string): DesktopReply => ({ type: 'refused', message })

const messageFor = (reason: GrantRefusal): string => {
  switch (reason) {
    case 'missing':
      return MESSAGES.missing
    case 'not-a-video':
    case 'not-a-file':
      return MESSAGES.notVideo
    default: {
      const unreachable: never = reason
      return unreachable
    }
  }
}

export const createDesktopService = (deps: DesktopServiceDeps): DesktopService => {
  const { grants, store, readdir, now } = deps
  const idByPath = new Map<string, string>()
  const pathById = new Map<string, string>()

  const recentIdFor = (path: string): string => {
    const known = idByPath.get(path)
    if (known !== undefined) return known
    const recentId = deps.newId()
    idByPath.set(path, recentId)
    pathById.set(recentId, path)
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

  const openDialog = async (): Promise<DesktopReply> => {
    const paths = await deps.showOpenDialog()
    if (paths.length === 0) return DONE
    return openPaths(paths)
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
    request: Extract<DesktopRequest, { type: 'describeFile' }>,
  ): Promise<DesktopReply> => {
    const file = grants.fileOf(request.fileId)
    if (file === null) return refused(MESSAGES.notOpen)
    store.update((state) => addRecent(state, { path: file.path, at: now() }))
    deps.addRecentDocument(file.path)
    return {
      type: 'file',
      file: {
        fileId: file.fileId,
        label: titleFromFileName(file.name),
        folder: basename(dirname(file.path)),
        resumeAt: resumeFor(store.read(), { file }),
        next: await nextAfter({ file, queue: request.queue }),
      },
    }
  }

  const recordPosition = (
    request: Extract<DesktopRequest, { type: 'savePosition' }>,
  ): DesktopReply => {
    const file = grants.fileOf(request.fileId)
    if (file === null) return refused(MESSAGES.notOpen)
    store.update((state) =>
      savePosition(state, {
        file: { path: file.path, size: file.size, mtimeMs: file.mtimeMs },
        position: request.position,
        duration: request.duration,
        at: now(),
      }),
    )
    return DONE
  }

  const listRecents = (): DesktopReply => {
    const state = store.read()
    return {
      type: 'recents',
      recents: state.recents.map((recent) => ({
        recentId: recentIdFor(recent.path),
        label: titleFromFileName(basename(recent.path)),
        from: basename(dirname(recent.path)),
        watched: watchedShare(state, { path: recent.path }),
      })),
    }
  }

  const openRecent = async (recentId: string): Promise<DesktopReply> => {
    const path = pathById.get(recentId)
    if (path === undefined) return refused(MESSAGES.unknownRecent)
    const result = await grants.grant(path)
    if (!result.ok) return refused(messageFor(result.reason))
    return { type: 'play', target: { fileId: result.file.fileId, queue: [] } }
  }

  const dropRecent = (recentId: string): DesktopReply => {
    const path = pathById.get(recentId)
    if (path !== undefined) store.update((state) => removeRecent(state, { path }))
    return DONE
  }

  const handleRequest = async (request: DesktopRequest): Promise<DesktopReply> => {
    switch (request.type) {
      case 'ready':
        deps.onReady()
        return DONE
      case 'openDialog':
        return openDialog()
      case 'describeFile':
        return describeFile(request)
      case 'savePosition':
        return recordPosition(request)
      case 'listRecents':
        return listRecents()
      case 'openRecent':
        return openRecent(request.recentId)
      case 'removeRecent':
        return dropRecent(request.recentId)
      case 'clearRecents':
        store.update(clearRecents)
        deps.clearRecentDocuments()
        return DONE
      default: {
        const unreachable: never = request
        return unreachable
      }
    }
  }

  const handle = async (envelope: unknown): Promise<DesktopReply> => {
    if (!isInvokeEnvelope(envelope)) return refused(MESSAGES.unknownRequest)
    switch (envelope.kind) {
      case 'page':
        return handleRequest(envelope.request)
      case 'drop':
        return openPaths(envelope.paths)
      default: {
        const unreachable: never = envelope
        return unreachable
      }
    }
  }

  return { handle, openPaths, openDialog }
}
