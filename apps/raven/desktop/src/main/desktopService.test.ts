import { describe, expect, it } from 'bun:test'
import { dirname, basename } from 'node:path'
import { DESKTOP_REPLIES, isOpaqueId, MAX_QUEUE } from '@/shared/protocol'
import { createGrants, type Grants } from '@/main/grants'
import { createStateStore, type StateFs, type Timers } from '@/main/stateStore'
import { EMPTY_STATE } from '@/main/playerState'
import { createDesktopService, MESSAGES } from '@/main/desktopService'
import type { DownloadService } from '@/main/downloads/downloadService'
import { EMPTY_CONFIG, type ConfigStore, type DesktopConfig } from '@/main/desktopConfig'
import { CALL_MESSAGES, type ServerCallResult } from '@/main/servers/serverCalls'
import { removeServer } from '@/main/servers/serverList'
import { TRUST_MESSAGES, TRUST_OUTCOME_KINDS, type TrustOutcome } from '@/main/servers/serverTrust'
import type { DesktopReply } from '@/shared/protocol'
import { createUpdateService, UPDATE_COPY } from '@/main/updateService'
import { UPDATE_PROBLEMS, type UpdateCheck } from '@/main/updates'
import type { OutputSettings } from '@raven/core'

type Entry = { real: string; isFile: boolean; size: number; mtimeMs: number }

const missing = (path: string): Error =>
  Object.assign(new Error(`ENOENT: no such file or directory, '${path}'`), { code: 'ENOENT' })

const sequentialId = (): (() => string) => {
  const counter = { n: 0 }
  return () => {
    counter.n += 1
    return `00000000-0000-4000-8000-${String(counter.n).padStart(12, '0')}`
  }
}

const OUTPUT_ANSWER = {
  output: { profile: 'passthrough', device: 'auto', passthrough: ['dts'], spatial: false },
  devices: [{ name: 'coreaudio/abc', description: 'Receiver' }],
  isEngineReady: true,
} as const satisfies {
  output: OutputSettings
  devices: { name: string; description: string }[]
  isEngineReady: boolean
}

const SERVER = '0f8fad5b-d9cb-469f-a165-70867728950e'
const OTHER_SERVER = '7c9e6679-7425-40de-944b-e07fc1f90ae7'

const ASK_ID = '00000000-0000-4000-8000-0000000000aa'

const DOWNLOADS_REPLY = {
  type: 'downloads',
  downloads: [],
  autoDeleteDefault: false,
} as const satisfies DesktopReply

const SPACE_REPLY = {
  type: 'space',
  space: { free: 1, total: 2, used: 0 },
} as const satisfies DesktopReply

const DOWNLOADED = `/data/downloads/${SERVER}`
const DOWNLOAD_ONE = `${DOWNLOADED}/11/video.mkv`
const DOWNLOAD_TWO = `${DOWNLOADED}/12/video.mkv`
const DOWNLOAD_LABELS = new Map([
  [DOWNLOAD_ONE, 'S01E01 Good News'],
  [DOWNLOAD_TWO, 'S01E02 Half Loop'],
])

const PLAY_REPLY = {
  type: 'play',
  target: { fileId: '00000000-0000-4000-8000-0000000000bb', queue: [] },
} as const satisfies DesktopReply

/**
 * A download service that records what reached it and answers each with a fixed reply. It
 * knows the two videos under `DOWNLOADED`, and `resumeAt` holds the position each
 * `notePosition` found already saved.
 */
const fakeDownloads = ({
  grants,
  savedPosition,
  serverPosition,
}: {
  grants: Grants
  savedPosition: () => number | null
  serverPosition: number
}) => {
  const reached: { name: string; input: unknown }[] = []
  const resumeAt: (number | null)[] = []
  const note = (name: string, input: unknown = null) => {
    reached.push({ name, input })
  }
  const downloads: DownloadService = {
    open: async (input) => {
      note('open', input)
      return PLAY_REPLY
    },
    sidecarsOf: () => [],
    fromLabelOf: ({ path }) =>
      path.startsWith(`${DOWNLOADED}/`) ? 'Downloaded from Vhagar' : null,
    labelOf: ({ path }) => DOWNLOAD_LABELS.get(path) ?? null,
    serverPositionOf: () => serverPosition,
    // The first download's next is the second, as its group would have it; any other file has none.
    nextOf: async ({ fileId }) => {
      if (grants.fileOf(fileId)?.path !== DOWNLOAD_ONE) return null
      const result = await grants.grant(DOWNLOAD_TWO)
      return result.ok ? result.file : null
    },
    noteOpened: (input) => note('noteOpened', input),
    notePosition: (input) => {
      note('notePosition', input)
      resumeAt.push(savedPosition())
    },
    notePlaying: (input) => note('notePlaying', input),
    ask: async (input) => {
      note('ask', input)
      return { type: 'done' }
    },
    retryAsk: async (input) => {
      note('retryAsk', input)
      return { type: 'done' }
    },
    confirm: async (input) => {
      note('confirm', input)
      return DOWNLOADS_REPLY
    },
    decline: (input) => {
      note('decline', input)
      return { type: 'done' }
    },
    list: () => {
      note('list')
      return DOWNLOADS_REPLY
    },
    readSpace: async () => {
      note('readSpace')
      return SPACE_REPLY
    },
    setDefaults: (input) => {
      note('setDefaults', input)
      return { ...DOWNLOADS_REPLY, autoDeleteDefault: input.autoDelete }
    },
    views: () => [],
    onSuspend: () => undefined,
    onResume: () => undefined,
    dispose: () => undefined,
    pause: async (input) => {
      note('pause', input)
      return DOWNLOADS_REPLY
    },
    resume: (input) => {
      note('resume', input)
      return DOWNLOADS_REPLY
    },
    retry: (input) => {
      note('retry', input)
      return DOWNLOADS_REPLY
    },
    remove: async (input) => {
      note('remove', input)
      return DOWNLOADS_REPLY
    },
    setAutoDelete: (input) => {
      note('setAutoDelete', input)
      return DOWNLOADS_REPLY
    },
    pauseAll: async () => {
      note('pauseAll')
      return DOWNLOADS_REPLY
    },
    resumeAll: () => {
      note('resumeAll')
      return DOWNLOADS_REPLY
    },
    removeAll: async () => {
      note('removeAll')
      return DOWNLOADS_REPLY
    },
    removeServer: async (input) => {
      note('removeServer', input)
    },
    showFolder: async () => {
      note('showFolder')
      return { type: 'done' }
    },
  }
  return { downloads, reached, resumeAt }
}

const SERVER_ENTRY = {
  id: SERVER,
  origin: 'https://raven.example',
  name: 'raven.example',
  addedAt: 1,
} as const

/** A config held in memory, starting with one server. */
const memoryConfig = (): ConfigStore & { set: (config: DesktopConfig) => void } => {
  const state: { value: DesktopConfig } = { value: { ...EMPTY_CONFIG, servers: [SERVER_ENTRY] } }
  return {
    read: () => state.value,
    update: (change) => {
      state.value = change(state.value)
    },
    flush: async () => undefined,
    isDirty: () => false,
    set: (config) => {
      state.value = config
    },
  }
}

const setup = ({
  files,
  dialog = [],
  addRecentDocument,
  stat,
  failOutputWrite = false,
  failOutputRead = false,
  trustOutcome = { kind: 'declined' },
  callResult = { ok: true, status: 200, body: '{}' },
  failBrowser = false,
  updateAnswers = [],
  serverPosition = 0,
}: {
  updateAnswers?: UpdateCheck[]
  /** What the fake download service says the server had as every file's resume spot. */
  serverPosition?: number
  failOutputWrite?: boolean
  failOutputRead?: boolean
  trustOutcome?: TrustOutcome
  callResult?: ServerCallResult
  failBrowser?: boolean
  files: Record<string, Partial<Entry>>
  dialog?: string[] | Error
  addRecentDocument?: (path: string) => void
  stat?: (path: string) => Promise<{ size: number; mtimeMs: number }>
}) => {
  const table = new Map(
    Object.entries(files).map(([path, entry]) => [
      path,
      { real: path, isFile: true, size: 100, mtimeMs: 1000, ...entry },
    ]),
  )
  const stats = { n: 0 }
  const grants = createGrants({
    fs: {
      realpath: async (path) => {
        const entry = table.get(path)
        if (!entry) throw missing(path)
        return entry.real
      },
      stat: async (path) => {
        stats.n += 1
        const entry = table.get(path)
        if (!entry) throw missing(path)
        return { isFile: () => entry.isFile, size: entry.size, mtimeMs: entry.mtimeMs }
      },
    },
    newId: sequentialId(),
  })

  const disk = new Map<string, string>()
  const stateFs: StateFs = {
    readFile: async (path) => {
      const text = disk.get(path)
      if (text === undefined) throw missing(path)
      return text
    },
    writeFile: async ({ path, data }) => {
      disk.set(path, data)
    },
    rename: async ({ from, to }) => {
      const text = disk.get(from)
      if (text !== undefined) disk.set(to, text)
      disk.delete(from)
    },
  }
  const store = createStateStore({
    fs: stateFs,
    file: '/data/player-state.json',
    initial: EMPTY_STATE,
    timers: { set: () => 0, clear: () => undefined },
    debounceMs: 1000,
    onError: (error) => {
      throw error
    },
  })

  const recentDocuments: string[] = []
  const errors: unknown[] = []
  const written: OutputSettings[] = []
  const buttons: boolean[] = []
  const spies = { recentDocuments, cleared: 0, ready: 0, dialogCalls: 0, errors, written, buttons }
  const clock = { now: 5000 }
  const statCalls: string[] = []
  const pendingTimers = new Map<number, () => void>()
  const timerCount = { next: 0 }
  const timers: Timers = {
    set: ({ run }) => {
      timerCount.next += 1
      pendingTimers.set(timerCount.next, run)
      return timerCount.next
    },
    clear: (handle) => {
      if (typeof handle === 'number') pendingTimers.delete(handle)
    },
  }
  const fireTimers = () => {
    const runs = [...pendingTimers.values()]
    pendingTimers.clear()
    runs.forEach((run) => run())
  }
  // A second sequence for recents ids, offset so it cannot collide with the grants' ids.
  const recentId = sequentialId()
  const config = memoryConfig()
  const calls: { serverId: string; method: string; path: string; body: string | null }[] = []
  const trusted: { origin: string; from: 'link' | 'app' }[] = []
  const removed: string[] = []
  const opened: { link: string; from: 'link' | 'app' }[] = []
  const batches: (readonly string[])[] = []
  const browsed: string[] = []
  const server = { calls, trusted, removed, opened, batches, browsed }
  const updateQueue = [...updateAnswers]
  const releasePages: string[] = []
  const releases = { checks: 0, opened: releasePages }
  const updates = createUpdateService({
    config,
    check: async () => {
      releases.checks += 1
      return updateQueue.shift() ?? { ok: true, finding: { kind: 'current' } }
    },
    current: '0.5.4',
    now: () => clock.now,
    openExternal: async (url) => {
      releases.opened.push(url)
    },
    announce: () => undefined,
    warn: () => undefined,
  })
  const { downloads, reached, resumeAt } = fakeDownloads({
    grants,
    savedPosition: () => store.read().resume[0]?.position ?? null,
    serverPosition,
  })
  const service = createDesktopService({
    updates,
    downloads,
    config,
    serverCalls: {
      callFromPage: async (input) => {
        server.calls.push(input)
        return callResult
      },
    },
    trust: {
      trust: async (input) => {
        server.trusted.push(input)
        if (trustOutcome.kind === TRUST_OUTCOME_KINDS.trusted) {
          config.update((current) => ({
            ...current,
            servers: [...current.servers, trustOutcome.server],
          }))
        }
        return trustOutcome
      },
      remove: async (serverId) => {
        server.removed.push(serverId)
        const isKnown = config.read().servers.some((entry) => entry.id === serverId)
        config.update((current) => removeServer({ config: current, serverId }))
        return isKnown
      },
    },
    links: {
      open: async (input) => {
        server.opened.push(input)
        return { type: 'done' }
      },
      openBatch: async (links) => {
        server.batches.push(links)
        return { type: 'playServer', target: { serverId: SERVER, mediaId: 7, at: 0, next: [] } }
      },
    },
    openExternal: async (url) => {
      server.browsed.push(url)
      if (failBrowser) throw new Error('no browser')
    },
    grants,
    store,
    readdir: async (dir) => {
      const names = [...table.keys()]
        .filter((path) => dirname(path) === dir)
        .map((path) => basename(path))
      if (names.length === 0) throw missing(dir)
      return names
    },
    showOpenDialog: async () => {
      spies.dialogCalls += 1
      if (dialog instanceof Error) throw dialog
      return dialog
    },
    addRecentDocument: addRecentDocument ?? ((path) => spies.recentDocuments.push(path)),
    clearRecentDocuments: () => {
      spies.cleared += 1
    },
    onReady: () => {
      spies.ready += 1
    },
    stat: async (path) => {
      statCalls.push(path)
      if (stat) return stat(path)
      const entry = table.get(path)
      if (!entry) throw missing(path)
      return { size: entry.size, mtimeMs: entry.mtimeMs }
    },
    timers,
    onError: (error) => {
      spies.errors.push(error)
    },
    newId: () => `10${recentId().slice(2)}`,
    now: () => clock.now,
    output: {
      read: async () => {
        if (failOutputRead) throw new Error('engine gone')
        return OUTPUT_ANSWER
      },
      write: async (output) => {
        if (failOutputWrite) throw new Error('disk full')
        spies.written.push(output)
      },
    },
    setWindowButtons: (isVisible) => {
      spies.buttons.push(isVisible)
    },
  })
  return {
    service,
    store,
    config,
    server,
    reached,
    resumeAt,
    releases,
    table,
    stats,
    spies,
    clock,
    grants,
    statCalls,
    fireTimers,
    pendingTimers,
  }
}

const idOf = (reply: Awaited<ReturnType<ReturnType<typeof setup>['service']['openPaths']>>) => {
  if (reply.type !== DESKTOP_REPLIES.play) throw new Error(`expected play, got ${reply.type}`)
  return reply.target
}

const show = {
  '/m/Show/Episode 1.mkv': {},
  '/m/Show/Episode 2.mkv': {},
  '/m/Show/Episode 10.mkv': {},
}

describe('handle', () => {
  it('refuses a request that is not an envelope', async () => {
    const { service } = setup({ files: {} })
    const refused = { type: 'refused', message: MESSAGES.unknownRequest } as const
    expect(
      await service.handle({ kind: 'page', request: { type: 'readFile', path: '/etc/hosts' } }),
    ).toEqual(refused)
    expect(await service.handle('nope')).toEqual(refused)
    expect(await service.handle(null)).toEqual(refused)
  })

  it('refuses a position or duration that is not a finite number', async () => {
    const { service } = setup({ files: show })
    const target = idOf(await service.openPaths(['/m/Show/Episode 1.mkv']))
    const refused = { type: 'refused', message: MESSAGES.unknownRequest } as const
    const save = ({ position, duration }: { position: unknown; duration: unknown }) =>
      service.handle({
        kind: 'page',
        request: { type: 'savePosition', fileId: target.fileId, position, duration },
      })
    expect(await save({ position: Number.NaN, duration: 120 })).toEqual(refused)
    expect(await save({ position: Infinity, duration: 120 })).toEqual(refused)
    expect(await save({ position: 40, duration: Number.NaN })).toEqual(refused)
    expect(await save({ position: '40', duration: 120 })).toEqual(refused)
    expect(await save({ position: 40, duration: 120 })).toEqual({ type: 'done' })
  })

  it('refuses a drop with no paths', async () => {
    const { service } = setup({ files: {} })
    expect(await service.handle({ kind: 'drop', paths: [] })).toEqual({
      type: 'refused',
      message: MESSAGES.nothingDropped,
    })
  })

  it('plays a drop', async () => {
    const { service } = setup({ files: show })
    const reply = await service.handle({ kind: 'drop', paths: ['/m/Show/Episode 1.mkv'] })
    expect(reply.type).toBe('play')
  })

  it('calls onReady and replies done', async () => {
    const { service, spies } = setup({ files: {} })
    expect(await service.handle({ kind: 'page', request: { type: 'ready' } })).toEqual({
      type: 'done',
    })
    expect(spies.ready).toBe(1)
  })

  it('opens the dialog on request', async () => {
    const { service, spies } = setup({ files: show, dialog: ['/m/Show/Episode 2.mkv'] })
    const reply = await service.handle({ kind: 'page', request: { type: 'openDialog' } })
    expect(reply.type).toBe('play')
    expect(spies.dialogCalls).toBe(1)
  })
})

describe('openPaths', () => {
  it('plays the first and queues the rest, skipping what is refused', async () => {
    const { service, grants } = setup({
      files: { '/m/a.mkv': {}, '/m/notes.txt': {}, '/m/b.mkv': {} },
    })
    const target = idOf(await service.openPaths(['/m/a.mkv', '/m/notes.txt', '/m/b.mkv']))
    expect(grants.fileOf(target.fileId)!.name).toBe('a.mkv')
    expect(target.queue.map((id) => grants.fileOf(id)!.name)).toEqual(['b.mkv'])
  })

  it('plays the first granted when the first path is refused', async () => {
    const { service, grants } = setup({ files: { '/m/a.mkv': {}, '/m/notes.txt': {} } })
    const target = idOf(await service.openPaths(['/m/notes.txt', '/m/a.mkv']))
    expect(grants.fileOf(target.fileId)!.name).toBe('a.mkv')
    expect(target.queue).toEqual([])
  })

  it('refuses a non-video as notVideo, a directory as notVideo, a missing file as missing', async () => {
    const { service } = setup({
      files: { '/m/notes.txt': {}, '/m/dir.mkv': { isFile: false } },
    })
    expect(await service.openPaths(['/m/notes.txt'])).toEqual({
      type: 'refused',
      message: MESSAGES.notVideo,
    })
    expect(await service.openPaths(['/m/dir.mkv'])).toEqual({
      type: 'refused',
      message: MESSAGES.notVideo,
    })
    expect(await service.openPaths(['/m/gone.mkv'])).toEqual({
      type: 'refused',
      message: MESSAGES.missing,
    })
  })

  it('answers with the first refusal when none is granted', async () => {
    const { service } = setup({ files: { '/m/notes.txt': {} } })
    expect(await service.openPaths(['/m/gone.mkv', '/m/notes.txt'])).toEqual({
      type: 'refused',
      message: MESSAGES.missing,
    })
  })

  it('refuses an empty list as nothingDropped', async () => {
    const { service } = setup({ files: {} })
    expect(await service.openPaths([])).toEqual({
      type: 'refused',
      message: MESSAGES.nothingDropped,
    })
  })

  it('caps a bulk open at one target and 100 queued, granting 101 files', async () => {
    const paths = Array.from({ length: 5000 }, (_, i) => `/m/v${String(i).padStart(4, '0')}.mkv`)
    const { service, stats } = setup({
      files: Object.fromEntries(paths.map((path) => [path, {}])),
    })
    const target = idOf(await service.openPaths(paths))
    expect(target.queue).toHaveLength(MAX_QUEUE)
    expect(stats.n).toBe(MAX_QUEUE + 1)
  })

  it('keeps a file dropped twice out of its own queue', async () => {
    const { service } = setup({ files: { '/m/a.mkv': {}, '/m/b.mkv': {} } })
    const target = idOf(await service.openPaths(['/m/a.mkv', '/m/a.mkv', '/m/b.mkv', '/m/b.mkv']))
    expect(target.queue).toHaveLength(1)
    expect(target.queue).not.toContain(target.fileId)
  })
})

describe('openDialog', () => {
  it('is done when the dialog is cancelled', async () => {
    const { service } = setup({ files: show, dialog: [] })
    expect(await service.openDialog()).toEqual({ type: 'done' })
  })

  it('plays what the dialog returned', async () => {
    const { service } = setup({ files: show, dialog: ['/m/Show/Episode 1.mkv'] })
    expect((await service.openDialog()).type).toBe('play')
  })
})

describe('describeFile', () => {
  const describeFile = ({
    service,
    fileId,
    queue = [],
  }: {
    service: ReturnType<typeof setup>['service']
    fileId: string
    queue?: string[]
  }) => service.handle({ kind: 'page', request: { type: 'describeFile', fileId, queue } })

  it('describes the file, finds the next in its folder and records the open', async () => {
    const { service, spies, store } = setup({ files: show })
    const { fileId } = idOf(await service.openPaths(['/m/Show/Episode 1.mkv']))
    const reply = await describeFile({ service, fileId })
    if (reply.type !== DESKTOP_REPLIES.file) throw new Error(`expected file, got ${reply.type}`)
    expect(reply.file).toMatchObject({
      fileId,
      label: 'Episode 1',
      folder: 'Show',
      resumeAt: 0,
    })
    expect(reply.file.next!.label).toBe('Episode 2')
    expect(isOpaqueId(reply.file.next!.fileId)).toBe(true)
    expect(reply.file.next!.queue).toEqual([])
    expect(spies.recentDocuments).toEqual(['/m/Show/Episode 1.mkv'])
    expect(store.read().recents).toEqual([
      { kind: 'file', path: '/m/Show/Episode 1.mkv', openedAt: 5000 },
    ])
  })

  it('has no next after the last video', async () => {
    const { service } = setup({ files: show })
    const { fileId } = idOf(await service.openPaths(['/m/Show/Episode 10.mkv']))
    const reply = await describeFile({ service, fileId })
    expect(reply.type === DESKTOP_REPLIES.file && reply.file.next).toBeNull()
  })

  it('prefers a granted queue entry over the folder', async () => {
    const { service } = setup({ files: { ...show, '/m/Other/Film.mkv': {} } })
    const target = idOf(
      await service.openPaths([
        '/m/Show/Episode 1.mkv',
        '/m/Other/Film.mkv',
        '/m/Show/Episode 2.mkv',
      ]),
    )
    const reply = await describeFile({ service, fileId: target.fileId, queue: target.queue })
    if (reply.type !== DESKTOP_REPLIES.file) throw new Error('expected file')
    expect(reply.file.next!.label).toBe('Film')
    expect(reply.file.next!.queue).toEqual(target.queue.slice(1))
  })

  it('skips queue entries main no longer knows', async () => {
    const { service } = setup({ files: show })
    const target = idOf(
      await service.openPaths(['/m/Show/Episode 1.mkv', '/m/Show/Episode 10.mkv']),
    )
    const stranger = '00000000-0000-4000-8000-0000000000ff'
    const reply = await describeFile({
      service,
      fileId: target.fileId,
      queue: [stranger, ...target.queue],
    })
    if (reply.type !== DESKTOP_REPLIES.file) throw new Error('expected file')
    expect(reply.file.next!.label).toBe('Episode 10')
    expect(reply.file.next!.queue).toEqual([])
  })

  it('falls back to the folder when no queue entry is known', async () => {
    const { service } = setup({ files: show })
    const { fileId } = idOf(await service.openPaths(['/m/Show/Episode 1.mkv']))
    const stranger = '00000000-0000-4000-8000-0000000000ff'
    const reply = await describeFile({ service, fileId, queue: [stranger] })
    expect(reply.type === DESKTOP_REPLIES.file && reply.file.next!.label).toBe('Episode 2')
  })

  it('walks the folder of the real file when the opened path is a symlink', async () => {
    const { service } = setup({
      files: { ...show, '/links/watch.mkv': { real: '/m/Show/Episode 1.mkv' } },
    })
    const { fileId } = idOf(await service.openPaths(['/links/watch.mkv']))
    const reply = await describeFile({ service, fileId })
    if (reply.type !== DESKTOP_REPLIES.file) throw new Error('expected file')
    expect(reply.file.folder).toBe('Show')
    expect(reply.file.next!.label).toBe('Episode 2')
  })

  it('is refused notOpen for an id that was never granted', async () => {
    const { service } = setup({ files: {} })
    expect(await describeFile({ service, fileId: '00000000-0000-4000-8000-0000000000aa' })).toEqual(
      {
        type: 'refused',
        message: MESSAGES.notOpen,
      },
    )
  })

  it('describes a download by its title and its server, and tells the download service it opened', async () => {
    const { service, reached } = setup({ files: { [DOWNLOAD_ONE]: {}, [DOWNLOAD_TWO]: {} } })
    const target = idOf(await service.openPaths([DOWNLOAD_ONE, DOWNLOAD_TWO]))
    const reply = await describeFile({ service, fileId: target.fileId, queue: target.queue })
    if (reply.type !== 'file') throw new Error(`expected file, got ${reply.type}`)
    expect(reply.file).toMatchObject({
      fileId: target.fileId,
      label: 'S01E01 Good News',
      folder: 'Downloaded from Vhagar',
    })
    expect(reply.file.next).toMatchObject({ label: 'S01E02 Half Loop' })
    expect(reached).toEqual([{ name: 'noteOpened', input: { fileId: target.fileId } }])
  })

  it("offers a download's next of its group when its queue is empty, as when opened from the recents", async () => {
    const { service } = setup({ files: { [DOWNLOAD_ONE]: {}, [DOWNLOAD_TWO]: {} } })
    const first = idOf(await service.openPaths([DOWNLOAD_ONE]))
    await describeFile({ service, fileId: first.fileId })
    const listed = await service.handle({ kind: 'page', request: { type: 'listRecents' } })
    if (listed.type !== 'recents') throw new Error(`expected recents, got ${listed.type}`)
    const [recent] = listed.recents
    if (recent === undefined) throw new Error('no recent')
    const reopened = idOf(
      await service.handle({
        kind: 'page',
        request: { type: 'openRecent', recentId: recent.recentId },
      }),
    )
    expect(reopened.queue).toEqual([])
    const reply = await describeFile({ service, fileId: reopened.fileId })
    if (reply.type !== 'file') throw new Error(`expected file, got ${reply.type}`)
    expect(reply.file.next).toMatchObject({ label: 'S01E02 Half Loop', queue: [] })
  })

  it('offers no next after the last download of its group', async () => {
    const { service } = setup({ files: { [DOWNLOAD_ONE]: {}, [DOWNLOAD_TWO]: {} } })
    const { fileId } = idOf(await service.openPaths([DOWNLOAD_TWO]))
    const reply = await describeFile({ service, fileId })
    expect(reply.type === 'file' && reply.file.next).toBeNull()
  })
})

describe('savePosition', () => {
  const save = ({
    service,
    fileId,
    position,
    duration,
  }: {
    service: ReturnType<typeof setup>['service']
    fileId: string
    position: number
    duration: number | null
  }) =>
    service.handle({ kind: 'page', request: { type: 'savePosition', fileId, position, duration } })
  const describe1 = ({
    service,
    fileId,
  }: {
    service: ReturnType<typeof setup>['service']
    fileId: string
  }) => service.handle({ kind: 'page', request: { type: 'describeFile', fileId, queue: [] } })

  it('resumes from the saved position', async () => {
    const { service } = setup({ files: show })
    const { fileId } = idOf(await service.openPaths(['/m/Show/Episode 1.mkv']))
    expect(await save({ service, fileId, position: 40, duration: 120 })).toEqual({ type: 'done' })
    const reply = await describe1({ service, fileId })
    expect(reply.type === DESKTOP_REPLIES.file && reply.file.resumeAt).toBe(40)
  })

  it('starts at 0 once the file changed on disk and was granted again', async () => {
    const { service, table } = setup({ files: show })
    const first = idOf(await service.openPaths(['/m/Show/Episode 1.mkv']))
    await save({ service, fileId: first.fileId, position: 40, duration: 120 })
    const entry = table.get('/m/Show/Episode 1.mkv')
    if (!entry) throw new Error('fixture missing')
    table.set('/m/Show/Episode 1.mkv', { ...entry, mtimeMs: 2000 })
    const again = idOf(await service.openPaths(['/m/Show/Episode 1.mkv']))
    const reply = await describe1({ service, fileId: again.fileId })
    expect(reply.type === DESKTOP_REPLIES.file && reply.file.resumeAt).toBe(0)
  })

  it('is refused notOpen for an id that was never granted', async () => {
    const { service } = setup({ files: {} })
    expect(
      await save({
        service,
        fileId: '00000000-0000-4000-8000-0000000000aa',
        position: 40,
        duration: 120,
      }),
    ).toEqual({
      type: 'refused',
      message: MESSAGES.notOpen,
    })
  })

  it('notes the position with the download service once it is saved', async () => {
    const { service, reached, resumeAt } = setup({ files: show })
    const { fileId } = idOf(await service.openPaths(['/m/Show/Episode 1.mkv']))
    await save({ service, fileId, position: 40, duration: null })
    expect(reached).toEqual([
      { name: 'notePosition', input: { fileId, position: 40, duration: null } },
    ])
    expect(resumeAt).toEqual([40])
  })

  it("starts a download with no local spot at the server's spot, and at the local one once saved", async () => {
    const { service } = setup({ files: { [DOWNLOAD_ONE]: {} }, serverPosition: 4200 })
    const { fileId } = idOf(await service.openPaths([DOWNLOAD_ONE]))
    const fresh = await describe1({ service, fileId })
    expect(fresh.type === 'file' && fresh.file.resumeAt).toBe(4200)
    await save({ service, fileId, position: 100, duration: 3000 })
    const saved = await describe1({ service, fileId })
    expect(saved.type === 'file' && saved.file.resumeAt).toBe(100)
  })

  it('starts a download at 0 when the server had no spot for it', async () => {
    const { service } = setup({ files: { [DOWNLOAD_ONE]: {} } })
    const { fileId } = idOf(await service.openPaths([DOWNLOAD_ONE]))
    const reply = await describe1({ service, fileId })
    expect(reply.type === 'file' && reply.file.resumeAt).toBe(0)
  })

  it('stamps the save with the clock', async () => {
    const { service, store, clock } = setup({ files: show })
    const { fileId } = idOf(await service.openPaths(['/m/Show/Episode 1.mkv']))
    clock.now = 9000
    await save({ service, fileId, position: 40, duration: null })
    expect(store.read().resume[0]).toMatchObject({ position: 40, duration: null, playedAt: 9000 })
  })
})

describe('saveTracks', () => {
  const saveTracks = ({
    service,
    fileId,
    audio,
    subtitle,
  }: {
    service: ReturnType<typeof setup>['service']
    fileId: string
    audio: unknown
    subtitle: unknown
  }) => service.handle({ kind: 'page', request: { type: 'saveTracks', fileId, audio, subtitle } })
  const describing = ({
    service,
    fileId,
  }: {
    service: ReturnType<typeof setup>['service']
    fileId: string
  }) => service.handle({ kind: 'page', request: { type: 'describeFile', fileId, queue: [] } })

  it('describes a file with no pick as tracks null', async () => {
    const { service } = setup({ files: show })
    const { fileId } = idOf(await service.openPaths(['/m/Show/Episode 1.mkv']))
    const reply = await describing({ service, fileId })
    expect(reply.type === DESKTOP_REPLIES.file && reply.file.tracks).toBeNull()
  })

  it('stores the pick and hands it back on the next describeFile', async () => {
    const { service, store, clock } = setup({ files: show })
    const { fileId } = idOf(await service.openPaths(['/m/Show/Episode 1.mkv']))
    clock.now = 7000
    expect(await saveTracks({ service, fileId, audio: 1, subtitle: 'embedded-0' })).toEqual({
      type: 'done',
    })
    const reply = await describing({ service, fileId })
    expect(reply.type === DESKTOP_REPLIES.file && reply.file.tracks).toEqual({
      audio: 1,
      subtitle: 'embedded-0',
    })
    expect(store.read().tracks).toEqual([
      { path: '/m/Show/Episode 1.mkv', audio: 1, subtitle: 'embedded-0', pickedAt: 7000 },
    ])
  })

  it('is refused notOpen for an id that was never granted', async () => {
    const { service, store } = setup({ files: {} })
    expect(
      await saveTracks({
        service,
        fileId: '00000000-0000-4000-8000-0000000000aa',
        audio: 1,
        subtitle: null,
      }),
    ).toEqual({
      type: 'refused',
      message: MESSAGES.notOpen,
    })
    expect(store.read().tracks).toEqual([])
  })

  it('refuses a track index that is not a whole number 0 or more, and stores nothing', async () => {
    const { service, store } = setup({ files: show })
    const { fileId } = idOf(await service.openPaths(['/m/Show/Episode 1.mkv']))
    const refused = { type: 'refused', message: MESSAGES.unknownRequest } as const
    expect(await saveTracks({ service, fileId, audio: Number.NaN, subtitle: null })).toEqual(
      refused,
    )
    expect(await saveTracks({ service, fileId, audio: Infinity, subtitle: null })).toEqual(refused)
    expect(await saveTracks({ service, fileId, audio: '1', subtitle: null })).toEqual(refused)
    expect(await saveTracks({ service, fileId, audio: 1.5, subtitle: null })).toEqual(refused)
    expect(await saveTracks({ service, fileId, audio: -1, subtitle: null })).toEqual(refused)
    expect(store.read().tracks).toEqual([])
  })
})

describe('windowButtons', () => {
  it('passes the visibility on and replies done', async () => {
    const { service, spies } = setup({ files: {} })
    expect(
      await service.handle({ kind: 'page', request: { type: 'windowButtons', isVisible: false } }),
    ).toEqual({ type: 'done' })
    await service.handle({ kind: 'page', request: { type: 'windowButtons', isVisible: true } })
    expect(spies.buttons).toEqual([false, true])
  })

  it('refuses a visibility that is not a boolean', async () => {
    const { service, spies } = setup({ files: {} })
    expect(
      await service.handle({ kind: 'page', request: { type: 'windowButtons', isVisible: 'yes' } }),
    ).toEqual({ type: 'refused', message: MESSAGES.unknownRequest })
    expect(spies.buttons).toEqual([])
  })
})

describe('output', () => {
  it('answers readOutput with what the output dependency reads', async () => {
    const { service } = setup({ files: {} })
    expect(await service.handle({ kind: 'page', request: { type: 'readOutput' } })).toEqual({
      type: 'output',
      ...OUTPUT_ANSWER,
    })
  })

  it('answers a failing read with a refusal, not a rejection, and reports the error', async () => {
    const { service, spies } = setup({ files: {}, failOutputRead: true })
    expect(await service.handle({ kind: 'page', request: { type: 'readOutput' } })).toEqual({
      type: 'refused',
      message: MESSAGES.failed,
    })
    expect(spies.errors).toHaveLength(1)
  })

  it('writes the settings rebuilt from the known fields, with passthrough deduplicated and ordered', async () => {
    const { service, spies } = setup({ files: {} })
    const reply = await service.handle({
      kind: 'page',
      request: {
        type: 'writeOutput',
        output: {
          profile: 'passthrough',
          device: 'coreaudio/abc',
          passthrough: ['dts', 'ac3', 'dts'],
          spatial: false,
        },
      },
    })
    expect(reply).toEqual({ type: 'done' })
    expect(spies.written).toEqual([
      {
        profile: 'passthrough',
        device: 'coreaudio/abc',
        passthrough: ['ac3', 'dts'],
        spatial: false,
      },
    ])
  })

  it('refuses settings that are not valid and writes nothing', async () => {
    const { service, spies } = setup({ files: {} })
    expect(
      await service.handle({
        kind: 'page',
        request: { type: 'writeOutput', output: { profile: 'pcm' } },
      }),
    ).toEqual({ type: 'refused', message: MESSAGES.unknownRequest })
    expect(spies.written).toEqual([])
  })

  it('answers a failing write with a refusal, not a rejection, and reports the error', async () => {
    const { service, spies } = setup({ files: {}, failOutputWrite: true })
    expect(
      await service.handle({
        kind: 'page',
        request: {
          type: 'writeOutput',
          output: { profile: 'pcm', device: 'auto', passthrough: [], spatial: false },
        },
      }),
    ).toEqual({ type: 'refused', message: MESSAGES.failed })
    expect(spies.errors).toHaveLength(1)
  })
})

describe('a failing dependency', () => {
  it('answers a rejecting open dialog with a refusal it can show, and reports the error', async () => {
    const failure = new Error('dialog broke')
    const { service, spies } = setup({ files: show, dialog: failure })
    expect(await service.handle({ kind: 'page', request: { type: 'openDialog' } })).toEqual({
      type: 'refused',
      message: MESSAGES.failed,
    })
    expect(await service.openDialog()).toEqual({ type: 'refused', message: MESSAGES.failed })
    expect(spies.errors).toEqual([failure, failure])
  })

  it('answers a throwing addRecentDocument with a refusal, not a rejection', async () => {
    const failure = new Error('dock broke')
    const { service, spies } = setup({
      files: show,
      addRecentDocument: () => {
        throw failure
      },
    })
    const { fileId } = idOf(await service.openPaths(['/m/Show/Episode 1.mkv']))
    expect(
      await service.handle({ kind: 'page', request: { type: 'describeFile', fileId, queue: [] } }),
    ).toEqual({ type: 'refused', message: MESSAGES.failed })
    expect(spies.errors).toEqual([failure])
  })
})

describe('recents', () => {
  const recents = async (service: ReturnType<typeof setup>['service']) => {
    const reply = await service.handle({ kind: 'page', request: { type: 'listRecents' } })
    if (reply.type !== DESKTOP_REPLIES.recents)
      throw new Error(`expected recents, got ${reply.type}`)
    return reply.recents
  }
  const open = async ({
    service,
    path,
  }: {
    service: ReturnType<typeof setup>['service']
    path: string
  }) => {
    const { fileId } = idOf(await service.openPaths([path]))
    await service.handle({ kind: 'page', request: { type: 'describeFile', fileId, queue: [] } })
    return fileId
  }

  it('lists the newest first with the share watched and no path', async () => {
    const { service, clock } = setup({ files: show })
    const first = await open({ service, path: '/m/Show/Episode 1.mkv' })
    await service.handle({
      kind: 'page',
      request: { type: 'savePosition', fileId: first, position: 40, duration: 120 },
    })
    clock.now = 6000
    await open({ service, path: '/m/Show/Episode 2.mkv' })
    const list = await recents(service)
    expect(list.map((recent) => recent.label)).toEqual(['Episode 2', 'Episode 1'])
    expect(list.map((recent) => recent.watched)).toEqual([null, expect.any(Number)])
    expect(list[1]!.watched).toBeCloseTo(0.33, 2)
    expect(list.every((recent) => recent.from === 'Show')).toBe(true)
    expect(list.every((recent) => isOpaqueId(recent.recentId))).toBe(true)
    expect(JSON.stringify(list)).not.toContain('/')
  })

  it('lists a download by its title and where it came from', async () => {
    const { service } = setup({ files: { ...show, [DOWNLOAD_ONE]: {} } })
    await open({ service, path: '/m/Show/Episode 1.mkv' })
    await open({ service, path: DOWNLOAD_ONE })
    const list = await recents(service)
    expect(list.map(({ label, from }) => [label, from])).toEqual([
      ['S01E01 Good News', 'Downloaded from Vhagar'],
      ['Episode 1', 'Show'],
    ])
  })

  it('keeps a recent id stable for the session', async () => {
    const { service } = setup({ files: show })
    await open({ service, path: '/m/Show/Episode 1.mkv' })
    const [one] = await recents(service)
    const [two] = await recents(service)
    expect(one!.recentId).toBe(two!.recentId)
  })

  it('opens a recent, and keeps it when the file has gone', async () => {
    const { service, table } = setup({ files: show })
    await open({ service, path: '/m/Show/Episode 1.mkv' })
    const [recent] = await recents(service)
    if (!recent) throw new Error('no recent')
    const reply = await service.handle({
      kind: 'page',
      request: { type: 'openRecent', recentId: recent.recentId },
    })
    expect(reply.type === DESKTOP_REPLIES.play && reply.target.queue).toEqual([])
    table.delete('/m/Show/Episode 1.mkv')
    expect(
      await service.handle({
        kind: 'page',
        request: { type: 'openRecent', recentId: recent.recentId },
      }),
    ).toEqual({ type: 'refused', message: MESSAGES.missing })
    expect(await recents(service)).toHaveLength(1)
  })

  it('refuses an unknown recent id', async () => {
    const { service } = setup({ files: show })
    expect(
      await service.handle({
        kind: 'page',
        request: { type: 'openRecent', recentId: '00000000-0000-4000-8000-0000000000aa' },
      }),
    ).toEqual({ type: 'refused', message: MESSAGES.unknownRecent })
  })

  it('removes one recent and clears all', async () => {
    const { service, spies } = setup({ files: show })
    await open({ service, path: '/m/Show/Episode 1.mkv' })
    await open({ service, path: '/m/Show/Episode 2.mkv' })
    const [newest] = await recents(service)
    if (!newest) throw new Error('no recent')
    expect(
      await service.handle({
        kind: 'page',
        request: { type: 'removeRecent', recentId: newest.recentId },
      }),
    ).toEqual({ type: 'done' })
    expect((await recents(service)).map((recent) => recent.label)).toEqual(['Episode 1'])
    expect(await service.handle({ kind: 'page', request: { type: 'clearRecents' } })).toEqual({
      type: 'done',
    })
    expect(await recents(service)).toEqual([])
    expect(spies.cleared).toBe(1)
  })

  it('no longer opens a removed recent, nor any recent after a clear', async () => {
    const { service } = setup({ files: show })
    await open({ service, path: '/m/Show/Episode 1.mkv' })
    await open({ service, path: '/m/Show/Episode 2.mkv' })
    await open({ service, path: '/m/Show/Episode 10.mkv' })
    const [removed, ...kept] = await recents(service)
    if (!removed) throw new Error('no recent')
    const openRecent = (recentId: string) =>
      service.handle({ kind: 'page', request: { type: 'openRecent', recentId } })
    const unknown = { type: 'refused', message: MESSAGES.unknownRecent } as const
    await service.handle({
      kind: 'page',
      request: { type: 'removeRecent', recentId: removed.recentId },
    })
    expect(await openRecent(removed.recentId)).toEqual(unknown)
    await service.handle({ kind: 'page', request: { type: 'clearRecents' } })
    expect(kept).toHaveLength(2)
    expect(await Promise.all(kept.map((recent) => openRecent(recent.recentId)))).toEqual([
      unknown,
      unknown,
    ])
  })

  it('shows no progress for a file replaced since its position was saved', async () => {
    const { service, table } = setup({ files: show })
    const fileId = await open({ service, path: '/m/Show/Episode 1.mkv' })
    await service.handle({
      kind: 'page',
      request: { type: 'savePosition', fileId, position: 40, duration: 120 },
    })
    expect((await recents(service))[0]!.watched).toBeCloseTo(0.33, 2)
    table.set('/m/Show/Episode 1.mkv', {
      real: '/m/Show/Episode 1.mkv',
      isFile: true,
      size: 999,
      mtimeMs: 2000,
    })
    expect((await recents(service))[0]!.watched).toBeNull()
  })

  it('keeps the progress when the player leaves before it learns the length', async () => {
    const { service } = setup({ files: show })
    const fileId = await open({ service, path: '/m/Show/Episode 1.mkv' })
    const save = (duration: number | null) =>
      service.handle({
        kind: 'page',
        request: { type: 'savePosition', fileId, position: 40, duration },
      })
    await save(120)
    await save(null)
    expect((await recents(service))[0]!.watched).toBeCloseTo(0.33, 2)
  })

  it('answers without a check that never comes back, showing no progress for that file alone', async () => {
    const stuck = '/m/Show/Episode 2.mkv'
    const { service, table, fireTimers } = setup({
      files: show,
      stat: (path) => {
        if (path === stuck) return new Promise(() => undefined)
        const entry = table.get(path)
        if (!entry) return Promise.reject(missing(path))
        return Promise.resolve({ size: entry.size, mtimeMs: entry.mtimeMs })
      },
    })
    const save = async (path: string) => {
      const fileId = await open({ service, path })
      await service.handle({
        kind: 'page',
        request: { type: 'savePosition', fileId, position: 30, duration: 120 },
      })
    }
    await save('/m/Show/Episode 1.mkv')
    await save(stuck)
    await save('/m/Show/Episode 10.mkv')
    const listed = recents(service)
    await Bun.sleep(0)
    fireTimers()
    const list = await listed
    expect(list.map((recent) => [recent.label, recent.watched])).toEqual([
      ['Episode 10', 0.25],
      ['Episode 2', null],
      ['Episode 1', 0.25],
    ])
  })

  it('checks a path once however many lists are waiting on it', async () => {
    const held = Promise.withResolvers<{ size: number; mtimeMs: number }>()
    const { service, statCalls, fireTimers } = setup({ files: show, stat: () => held.promise })
    const fileId = await open({ service, path: '/m/Show/Episode 1.mkv' })
    await open({ service, path: '/m/Show/Episode 2.mkv' })
    await service.handle({
      kind: 'page',
      request: { type: 'savePosition', fileId, position: 30, duration: 120 },
    })
    const first = recents(service)
    const second = recents(service)
    await Bun.sleep(0)
    // Episode 2 has no saved position, so it is not started whatever the disk says.
    expect(statCalls).toEqual(['/m/Show/Episode 1.mkv'])
    fireTimers()
    await Promise.all([first, second])
    const third = recents(service)
    await Bun.sleep(0)
    expect(statCalls).toEqual(['/m/Show/Episode 1.mkv'])
    held.resolve({ size: 100, mtimeMs: 1000 })
    const list = await third
    expect(list.map((recent) => recent.watched)).toEqual([null, 0.25])
    await recents(service)
    expect(statCalls).toEqual(['/m/Show/Episode 1.mkv', '/m/Show/Episode 1.mkv'])
  })

  it('shows no progress for a recent whose file has gone', async () => {
    const { service, table } = setup({ files: show })
    const fileId = await open({ service, path: '/m/Show/Episode 1.mkv' })
    await service.handle({
      kind: 'page',
      request: { type: 'savePosition', fileId, position: 40, duration: 120 },
    })
    table.delete('/m/Show/Episode 1.mkv')
    expect((await recents(service))[0]!.watched).toBeNull()
  })

  it('treats removing an unknown recent as done', async () => {
    const { service } = setup({ files: show })
    expect(
      await service.handle({
        kind: 'page',
        request: { type: 'removeRecent', recentId: '00000000-0000-4000-8000-0000000000aa' },
      }),
    ).toEqual({ type: 'done' })
  })
})

describe('server titles', () => {
  type Service = ReturnType<typeof setup>['service']
  const ask = ({ service, request }: { service: Service; request: unknown }) =>
    service.handle({ kind: 'page', request })
  const recents = async ({ service }: { service: Service }) => {
    const reply = await ask({ service, request: { type: 'listRecents' } })
    if (reply.type !== DESKTOP_REPLIES.recents)
      throw new Error(`expected recents, got ${reply.type}`)
    return reply.recents
  }
  const noteDune = ({ service, serverId = SERVER }: { service: Service; serverId?: string }) =>
    ask({
      service,
      request: { type: 'noteServerTitle', serverId, mediaId: 7, label: 'Dune', watched: 0.5 },
    })
  const unknownServer = { type: 'refused', message: CALL_MESSAGES.unknownServer } as const
  const listed = {
    type: 'servers',
    servers: [{ serverId: SERVER, origin: 'https://raven.example', name: 'raven.example' }],
  } as const satisfies DesktopReply

  describe('serverCall', () => {
    const call = {
      type: 'serverCall',
      serverId: SERVER,
      method: 'GET',
      path: '/api/media/7',
      body: null,
    } as const

    it('runs the call through the page allowlist and answers with what the server said', async () => {
      const { service, server } = setup({
        files: {},
        callResult: { ok: true, status: 423, body: '{"message":"locked"}' },
      })
      expect(await ask({ service, request: call })).toEqual({
        type: 'serverReply',
        status: 423,
        body: '{"message":"locked"}',
      })
      expect(server.calls).toEqual([
        { serverId: SERVER, method: 'GET', path: '/api/media/7', body: null },
      ])
    })

    it('answers a call that did not reach the server as unreachable', async () => {
      const { service } = setup({
        files: {},
        callResult: { ok: false, message: 'raven player could not reach raven.example.' },
      })
      expect(await ask({ service, request: call })).toEqual({
        type: 'serverUnreachable',
        message: 'raven player could not reach raven.example.',
      })
    })

    it('keeps only the fields it knows', async () => {
      const { service, server } = setup({ files: {} })
      await ask({ service, request: { ...call, origin: 'https://evil.example', headers: {} } })
      expect(server.calls).toEqual([
        { serverId: SERVER, method: 'GET', path: '/api/media/7', body: null },
      ])
    })

    it('refuses a method off the list without calling', async () => {
      const { service, server } = setup({ files: {} })
      expect(await ask({ service, request: { ...call, method: 'DELETE' } })).toEqual({
        type: 'refused',
        message: MESSAGES.unknownRequest,
      })
      expect(server.calls).toEqual([])
    })
  })

  describe('servers', () => {
    it('lists the servers in stored order as ids, origins and names', async () => {
      const { service, config } = setup({ files: {} })
      config.update((current) => ({
        ...current,
        servers: [
          ...current.servers,
          { id: OTHER_SERVER, origin: 'http://nas.local:8080', name: 'NAS', addedAt: 2 },
        ],
      }))
      expect(await ask({ service, request: { type: 'listServers' } })).toEqual({
        type: 'servers',
        servers: [
          { serverId: SERVER, origin: 'https://raven.example', name: 'raven.example' },
          { serverId: OTHER_SERVER, origin: 'http://nas.local:8080', name: 'NAS' },
        ],
      })
    })

    it('refuses an address with a path before asking trust anything', async () => {
      const { service, server } = setup({ files: {} })
      expect(
        await ask({ service, request: { type: 'addServer', origin: 'https://raven.example/x' } }),
      ).toEqual({ type: 'refused', message: MESSAGES.badServer })
      expect(server.trusted).toEqual([])
    })

    it('asks trust about the canonical origin, from the app, and lists the servers once trusted', async () => {
      const added = {
        id: OTHER_SERVER,
        origin: 'https://nas.example',
        name: 'nas.example',
        addedAt: 2,
      }
      const { service, server } = setup({
        files: {},
        trustOutcome: { kind: 'trusted', server: added, isNew: true },
      })
      const reply = await ask({
        service,
        request: { type: 'addServer', origin: 'https://NAS.example:443/' },
      })
      expect(server.trusted).toEqual([{ origin: 'https://nas.example', from: 'app' }])
      expect(reply).toEqual({
        type: 'servers',
        servers: [
          ...listed.servers,
          { serverId: OTHER_SERVER, origin: 'https://nas.example', name: 'nas.example' },
        ],
      })
    })

    it("asks trust about 'https://raven.example/' as its origin", async () => {
      const { service, server } = setup({ files: {} })
      expect(
        await ask({ service, request: { type: 'addServer', origin: 'https://raven.example/' } }),
      ).toEqual({ type: 'done' })
      expect(server.trusted).toEqual([{ origin: 'https://raven.example', from: 'app' }])
    })

    it.each([
      [{ kind: 'full' }, TRUST_MESSAGES.full],
      [{ kind: 'busy' }, TRUST_MESSAGES.busy],
      [
        { kind: 'unreachable', origin: 'https://nas.example' },
        TRUST_MESSAGES.unreachable('https://nas.example'),
      ],
      [{ kind: 'invalid' }, MESSAGES.badServer],
      [{ kind: 'unsaved' }, TRUST_MESSAGES.unsaved],
    ] satisfies [TrustOutcome, string][])(
      'refuses %j with its message',
      async (trustOutcome, message) => {
        const { service } = setup({ files: {}, trustOutcome })
        expect(
          await ask({ service, request: { type: 'addServer', origin: 'https://nas.example' } }),
        ).toEqual({ type: 'refused', message })
      },
    )

    it('renames a server, tidying the name, and refuses an empty name or an unknown id', async () => {
      const { service } = setup({ files: {} })
      expect(
        await ask({ service, request: { type: 'renameServer', serverId: SERVER, name: '' } }),
      ).toEqual({ type: 'refused', message: MESSAGES.badName })
      expect(
        await ask({
          service,
          request: { type: 'renameServer', serverId: SERVER, name: 'x'.repeat(81) },
        }),
      ).toEqual({ type: 'refused', message: MESSAGES.badName })
      expect(
        await ask({
          service,
          request: { type: 'renameServer', serverId: OTHER_SERVER, name: 'NAS' },
        }),
      ).toEqual(unknownServer)
      expect(
        await ask({
          service,
          request: { type: 'renameServer', serverId: SERVER, name: '  Home   NAS ' },
        }),
      ).toEqual({
        type: 'servers',
        servers: [{ serverId: SERVER, origin: 'https://raven.example', name: 'Home NAS' }],
      })
    })

    it("removes a server through trust and drops that server's recents", async () => {
      const { service, server, config } = setup({ files: {} })
      config.update((current) => ({
        ...current,
        servers: [
          ...current.servers,
          { id: OTHER_SERVER, origin: 'https://nas.example', name: 'nas.example', addedAt: 2 },
        ],
      }))
      await noteDune({ service })
      await noteDune({ service, serverId: OTHER_SERVER })
      expect(await recents({ service })).toHaveLength(2)
      expect(await ask({ service, request: { type: 'removeServer', serverId: SERVER } })).toEqual({
        type: 'servers',
        servers: [{ serverId: OTHER_SERVER, origin: 'https://nas.example', name: 'nas.example' }],
      })
      expect(server.removed).toEqual([SERVER])
      expect((await recents({ service })).map((recent) => recent.from)).toEqual(['nas.example'])
    })

    it('answers removing an unknown server with the list', async () => {
      const { service } = setup({ files: {} })
      expect(
        await ask({ service, request: { type: 'removeServer', serverId: OTHER_SERVER } }),
      ).toEqual(listed)
    })
  })

  describe('links', () => {
    it('opens a link the app was handed as from the app', async () => {
      const { service, server } = setup({ files: {} })
      const link = 'https://raven.example/watch/7'
      expect(await ask({ service, request: { type: 'openLink', link } })).toEqual({ type: 'done' })
      expect(server.opened).toEqual([{ link, from: 'app' }])
    })

    it('forwards a batch from main to the opener', async () => {
      const { service, server } = setup({ files: {} })
      const links = ['raven://play?server=https://raven.example&media=7', 'raven://x']
      expect(await service.openLinks(links)).toEqual({
        type: 'playServer',
        target: { serverId: SERVER, mediaId: 7, at: 0, next: [] },
      })
      expect(server.batches).toEqual([links])
    })
  })

  describe('openInBrowser', () => {
    it("opens the title's watch page on its server", async () => {
      const { service, server } = setup({ files: {} })
      expect(
        await ask({ service, request: { type: 'openInBrowser', serverId: SERVER, mediaId: 7 } }),
      ).toEqual({ type: 'done' })
      expect(server.browsed).toEqual(['https://raven.example/watch/7'])
    })

    it('refuses a server it does not know and opens nothing', async () => {
      const { service, server } = setup({ files: {} })
      expect(
        await ask({
          service,
          request: { type: 'openInBrowser', serverId: OTHER_SERVER, mediaId: 7 },
        }),
      ).toEqual(unknownServer)
      expect(server.browsed).toEqual([])
    })

    it('says so when the browser could not be opened', async () => {
      const { service } = setup({ files: {}, failBrowser: true })
      expect(
        await ask({ service, request: { type: 'openInBrowser', serverId: SERVER, mediaId: 7 } }),
      ).toEqual({ type: 'refused', message: MESSAGES.noBrowser })
    })
  })

  describe('server recents', () => {
    it('lists a noted title by its label, its server name and its share, with an opaque id', async () => {
      const { service } = setup({ files: {} })
      expect(await noteDune({ service })).toEqual({ type: 'done' })
      const [recent, ...rest] = await recents({ service })
      expect(rest).toEqual([])
      expect(recent).toEqual({
        recentId: expect.any(String),
        label: 'Dune',
        from: 'raven.example',
        watched: 0.5,
      })
      expect(isOpaqueId(recent!.recentId)).toBe(true)
      expect(recent!.recentId).not.toContain('/')
    })

    it('clamps the share to 0..1 and keeps a null', async () => {
      const { service } = setup({ files: {} })
      const note = (watched: unknown) =>
        ask({
          service,
          request: {
            type: 'noteServerTitle',
            serverId: SERVER,
            mediaId: 7,
            label: 'Dune',
            watched,
          },
        })
      await note(3)
      expect((await recents({ service }))[0]!.watched).toBe(1)
      await note(-2)
      expect((await recents({ service }))[0]!.watched).toBe(0)
      await note(null)
      expect((await recents({ service }))[0]!.watched).toBeNull()
      expect(await note(Number.NaN)).toEqual({ type: 'refused', message: MESSAGES.unknownRequest })
    })

    it('refuses noting a title on a server it does not know', async () => {
      const { service } = setup({ files: {} })
      expect(await noteDune({ service, serverId: OTHER_SERVER })).toEqual(unknownServer)
      expect(await recents({ service })).toEqual([])
    })

    it('opens a server recent at the start with nothing queued, as the server keeps the resume point', async () => {
      const { service } = setup({ files: {} })
      await noteDune({ service })
      const [recent] = await recents({ service })
      expect(
        await ask({ service, request: { type: 'openRecent', recentId: recent!.recentId } }),
      ).toEqual({ type: 'playServer', target: { serverId: SERVER, mediaId: 7, at: 0, next: [] } })
    })

    it('refuses a stale recent once its server has left the config, and leaves it off the list', async () => {
      const { service, config } = setup({ files: {} })
      await noteDune({ service })
      const [recent] = await recents({ service })
      config.set(EMPTY_CONFIG)
      expect(
        await ask({ service, request: { type: 'openRecent', recentId: recent!.recentId } }),
      ).toEqual(unknownServer)
      expect(await recents({ service })).toEqual([])
    })

    it('removes one server recent and clears both kinds', async () => {
      const { service } = setup({ files: show })
      const { fileId } = idOf(await service.openPaths(['/m/Show/Episode 1.mkv']))
      await ask({ service, request: { type: 'describeFile', fileId, queue: [] } })
      await noteDune({ service })
      const [dune, episode] = await recents({ service })
      expect([dune!.label, episode!.label]).toEqual(['Dune', 'Episode 1'])
      await ask({ service, request: { type: 'removeRecent', recentId: dune!.recentId } })
      expect((await recents({ service })).map((recent) => recent.label)).toEqual(['Episode 1'])
      await noteDune({ service })
      await ask({ service, request: { type: 'clearRecents' } })
      expect(await recents({ service })).toEqual([])
      expect(
        await ask({ service, request: { type: 'openRecent', recentId: dune!.recentId } }),
      ).toEqual({ type: 'refused', message: MESSAGES.unknownRecent })
    })
  })
})

describe('updates', () => {
  type Service = ReturnType<typeof setup>['service']
  const ask = ({ service, request }: { service: Service; request: unknown }) =>
    service.handle({ kind: 'page', request })
  const PAGE = 'https://github.com/codebend3r/maester/releases/tag/v0.6.0'
  const NEWER: UpdateCheck = {
    ok: true,
    finding: { kind: 'newer', version: '0.6.0', pageUrl: PAGE },
  }

  it('answers readUpdates with the status and checks nothing', async () => {
    const { service, releases } = setup({ files: {} })
    expect(await ask({ service, request: { type: 'readUpdates' } })).toEqual({
      type: 'updates',
      status: { isEnabled: true, current: '0.5.4', checkedAt: null, latest: null, problem: null },
    })
    expect(releases.checks).toBe(0)
  })

  it('turns the launch check off and on, answering the new status', async () => {
    const { service, config } = setup({ files: {} })
    const off = await ask({ service, request: { type: 'setUpdateCheck', isEnabled: false } })
    expect(off).toMatchObject({ type: 'updates', status: { isEnabled: false } })
    expect(config.read().updates.isEnabled).toBe(false)
    const on = await ask({ service, request: { type: 'setUpdateCheck', isEnabled: true } })
    expect(on).toMatchObject({ type: 'updates', status: { isEnabled: true } })
  })

  it('refuses a switch set by a string and changes nothing', async () => {
    const { service, config } = setup({ files: {} })
    expect(await ask({ service, request: { type: 'setUpdateCheck', isEnabled: 'false' } })).toEqual(
      { type: 'refused', message: MESSAGES.unknownRequest },
    )
    expect(config.read().updates.isEnabled).toBe(true)
  })

  it('checks when asked and answers the status the check left', async () => {
    const { service, releases, clock } = setup({ files: {}, updateAnswers: [NEWER] })
    expect(await ask({ service, request: { type: 'checkForUpdates' } })).toEqual({
      type: 'updates',
      status: {
        isEnabled: true,
        current: '0.5.4',
        checkedAt: clock.now,
        latest: '0.6.0',
        problem: null,
      },
    })
    expect(releases.checks).toBe(1)
  })

  it('answers a failed check with its problem, not a refusal', async () => {
    const { service } = setup({
      files: {},
      updateAnswers: [{ ok: false, problem: UPDATE_PROBLEMS.busy }],
    })
    expect(await ask({ service, request: { type: 'checkForUpdates' } })).toMatchObject({
      type: 'updates',
      status: { latest: null, problem: UPDATE_PROBLEMS.busy },
    })
  })

  it('refuses openRelease before a newer release is found and opens nothing', async () => {
    const { service, releases } = setup({ files: {} })
    expect(await ask({ service, request: { type: 'openRelease' } })).toEqual({
      type: 'refused',
      message: UPDATE_COPY.noRelease,
    })
    expect(UPDATE_COPY.noRelease).toContain('has not found a newer release')
    expect(releases.opened).toEqual([])
  })

  it('opens the release page once a newer release is found', async () => {
    const { service, releases } = setup({ files: {}, updateAnswers: [NEWER] })
    await ask({ service, request: { type: 'checkForUpdates' } })
    expect(await ask({ service, request: { type: 'openRelease' } })).toEqual({ type: 'done' })
    expect(releases.opened).toEqual([PAGE])
  })
})

describe('downloads', () => {
  type Service = ReturnType<typeof setup>['service']
  const ask = ({ service, request }: { service: Service; request: unknown }) =>
    service.handle({ kind: 'page', request })

  it('hands a confirmation to the download service and answers its list', async () => {
    const { service, reached } = setup({ files: {} })
    expect(
      await ask({ service, request: { type: 'confirmDownload', askId: ASK_ID, autoDelete: true } }),
    ).toEqual(DOWNLOADS_REPLY)
    expect(reached).toEqual([{ name: 'confirm', input: { askId: ASK_ID, autoDelete: true } }])
  })

  it('answers listDownloads from the download service', async () => {
    const { service, reached } = setup({ files: {} })
    expect(await ask({ service, request: { type: 'listDownloads' } })).toEqual(DOWNLOADS_REPLY)
    expect(reached).toEqual([{ name: 'list', input: null }])
  })

  it.each([
    [
      { type: 'declineDownload', askId: ASK_ID },
      { name: 'decline', input: { askId: ASK_ID } },
    ],
    [
      { type: 'retryDownloadAsk', askId: ASK_ID },
      { name: 'retryAsk', input: { askId: ASK_ID } },
    ],
    [{ type: 'readSpace' }, { name: 'readSpace', input: null }],
    [
      { type: 'setDownloadDefaults', autoDelete: true },
      { name: 'setDefaults', input: { autoDelete: true } },
    ],
  ])('hands %j to the download service', async (request, call) => {
    const { service, reached } = setup({ files: {} })
    await ask({ service, request })
    expect(reached).toEqual([call])
  })

  it('refuses a confirmation that names its ask by anything but an opaque id', async () => {
    const { service, reached } = setup({ files: {} })
    expect(
      await ask({
        service,
        request: { type: 'confirmDownload', askId: '../downloads.json', autoDelete: false },
      }),
    ).toEqual({ type: 'refused', message: MESSAGES.unknownRequest })
    expect(reached).toEqual([])
  })

  it.each([
    [
      { type: 'pauseDownload', downloadId: ASK_ID },
      { name: 'pause', input: { downloadId: ASK_ID } },
    ],
    [
      { type: 'resumeDownload', downloadId: ASK_ID },
      { name: 'resume', input: { downloadId: ASK_ID } },
    ],
    [
      { type: 'retryDownload', downloadId: ASK_ID },
      { name: 'retry', input: { downloadId: ASK_ID } },
    ],
    [
      { type: 'deleteDownload', downloadId: ASK_ID },
      { name: 'remove', input: { downloadId: ASK_ID } },
    ],
    [
      { type: 'setDownloadAutoDelete', downloadId: ASK_ID, autoDelete: true },
      { name: 'setAutoDelete', input: { downloadId: ASK_ID, autoDelete: true } },
    ],
    [{ type: 'pauseAllDownloads' }, { name: 'pauseAll', input: null }],
    [{ type: 'resumeAllDownloads' }, { name: 'resumeAll', input: null }],
    [{ type: 'deleteAllDownloads' }, { name: 'removeAll', input: null }],
  ])('hands %j to the download service and answers its list', async (request, call) => {
    const { service, reached } = setup({ files: {} })
    expect(await ask({ service, request })).toEqual(DOWNLOADS_REPLY)
    expect(reached).toEqual([call])
  })

  it('hands showDownloadsFolder to the download service', async () => {
    const { service, reached } = setup({ files: {} })
    expect(await ask({ service, request: { type: 'showDownloadsFolder' } })).toEqual({
      type: 'done',
    })
    expect(reached).toEqual([{ name: 'showFolder', input: null }])
  })

  it('refuses a download action that names its download by anything but an opaque id', async () => {
    const { service, reached } = setup({ files: {} })
    expect(
      await ask({ service, request: { type: 'deleteDownload', downloadId: '../downloads' } }),
    ).toEqual({ type: 'refused', message: MESSAGES.unknownRequest })
    expect(reached).toEqual([])
  })

  it('hands openDownload to the download service and answers what it plays', async () => {
    const { service, reached } = setup({ files: {} })
    expect(await ask({ service, request: { type: 'openDownload', downloadId: ASK_ID } })).toEqual(
      PLAY_REPLY,
    )
    expect(reached).toEqual([{ name: 'open', input: { downloadId: ASK_ID } }])
  })

  it('refuses openDownload naming its download by anything but an opaque id', async () => {
    const { service, reached } = setup({ files: {} })
    expect(
      await ask({ service, request: { type: 'openDownload', downloadId: '../downloads' } }),
    ).toEqual({ type: 'refused', message: MESSAGES.unknownRequest })
    expect(reached).toEqual([])
  })
})
