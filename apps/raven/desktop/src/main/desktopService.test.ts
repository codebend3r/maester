import {
  DESKTOP_REPLIES,
  DESKTOP_REQUESTS,
  type DesktopReply,
  isOpaqueId,
  type OutputSettings,
  type PageSession,
  PLAYER_SOURCE_KINDS,
  DOWNLOAD_TARGET_KINDS,
} from '@raven/core'
import { describe, expect, it } from 'bun:test'
import { createGrants, type Grants } from '@/main/grants'
import { createStateStore, type StateFs } from '@/main/stateStore'
import { EMPTY_STATE } from '@/main/playerState'
import { createDesktopService, MESSAGES } from '@/main/desktopService'
import type { DownloadService } from '@/main/downloads/downloadService'
import type { ConfigStore, DesktopConfig } from '@/main/desktopConfig'
import type { ServerTitles } from '@/main/servers/serverTitles'
import { configFor } from '@/main/test/configFakes'
import { createUpdateService, UPDATE_COPY } from '@/main/updateService'
import { UPDATE_PROBLEMS, type UpdateCheck } from '@/main/updates'

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

const ASK_ID = '00000000-0000-4000-8000-0000000000aa'

const DOWNLOADS_REPLY = {
  type: 'downloads',
  downloads: [],
  shouldAutoDeleteByDefault: false,
} as const satisfies DesktopReply

const SPACE_REPLY = {
  type: 'space',
  space: { free: 1, total: 2, used: 0 },
} as const satisfies DesktopReply

const DOWNLOADED = `/data/downloads/${SERVER}`
const DOWNLOAD_ONE = `${DOWNLOADED}/11/video.mkv`
const DOWNLOAD_TWO = `${DOWNLOADED}/12/video.mkv`
const DOWNLOAD_MEDIA = new Map([
  [DOWNLOAD_ONE, 11],
  [DOWNLOAD_TWO, 12],
])
const DOWNLOAD_LABELS = new Map([
  [DOWNLOAD_ONE, 'S01E01 Good News'],
  [DOWNLOAD_TWO, 'S01E02 Half Loop'],
])

const PLAY_REPLY = {
  type: 'play',
  target: { fileId: '00000000-0000-4000-8000-0000000000bb', queue: [] },
} as const satisfies DesktopReply

type FakeDownloadsProps = {
  grants: Grants
  savedPosition: () => number | null
  serverPosition: number
}

/**
 * A download service that records what reached it and answers each with a fixed reply. It
 * knows the two videos under `DOWNLOADED`, and `resumeAt` holds the position each
 * `notePosition` found already saved.
 */
const fakeDownloads = ({ grants, savedPosition, serverPosition }: FakeDownloadsProps) => {
  const reached: { name: string; input: unknown }[] = []
  const resumeAt: (number | null)[] = []
  const note = (name: string, input: unknown = null) => {
    reached.push({ name, input })
  }
  const downloads: DownloadService = {
    pictureOf: () => null,
    open: async (input) => {
      note('open', input)
      return PLAY_REPLY
    },
    openTitle: async (input) => {
      note('openTitle', input)
      return null
    },
    trackPathOf: async () => null,
    sidecarsOf: () => [],
    fromLabelOf: ({ path }) =>
      path.startsWith(`${DOWNLOADED}/`) ? 'Downloaded from Vhagar' : null,
    labelOf: ({ path }) => DOWNLOAD_LABELS.get(path) ?? null,
    mediaIdOf: ({ path }) => DOWNLOAD_MEDIA.get(path) ?? null,
    logoOf: () => null,
    serverPositionOf: () => serverPosition,
    // The first download's next is the second, as its group would have it; any other file has none.
    nextOf: async ({ fileId }) => {
      if (grants.fileOf(fileId)?.path !== DOWNLOAD_ONE) return null
      return grants.grant(DOWNLOAD_TWO)
    },
    noteOpened: (input) => note('noteOpened', input),
    notePosition: (input) => {
      note('notePosition', input)
      resumeAt.push(savedPosition())
    },
    notePlaying: (input) => note('notePlaying', input),
    playbackLeft: (input) => note('playbackLeft', input),
    pageReady: () => note('pageReady'),
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
      return { ...DOWNLOADS_REPLY, shouldAutoDeleteByDefault: input.autoDelete }
    },
    views: () => [],
    onSuspend: () => undefined,
    onResume: () => undefined,
    accessEnded: () => undefined,
    accountSwitched: () => undefined,
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
    showFolder: async () => {
      note('showFolder')
      return { type: 'done' }
    },
  }
  return { downloads, reached, resumeAt }
}

const TITLE_REPLY = {
  type: DESKTOP_REPLIES.title,
  source: { kind: PLAYER_SOURCE_KINDS.server, serverId: SERVER, mediaId: 7 },
  resumeAt: 30,
  next: [8],
} as const satisfies DesktopReply

const NAVIGATE_REPLY = {
  type: DESKTOP_REPLIES.navigate,
  to: '/watch/7',
} as const satisfies DesktopReply

/** A config held in memory, with its one server. */
const memoryConfig = (): ConfigStore & { set: (config: DesktopConfig) => void } => {
  const state: { value: DesktopConfig } = {
    value: configFor({ id: SERVER, origin: 'https://raven.example' }),
  }
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

type SetupProps = {
  /** Whether the page's account takes the session it is sent. */
  isSessionTaken?: boolean
  updateAnswers?: UpdateCheck[]
  /** What the fake download service says the server had as every file's resume spot. */
  serverPosition?: number
  failOutputWrite?: boolean
  failOutputRead?: boolean
  files: Record<string, Partial<Entry>>
}

const setup = ({
  files,
  failOutputWrite = false,
  failOutputRead = false,
  updateAnswers = [],
  serverPosition = 0,
  isSessionTaken = true,
}: SetupProps) => {
  const table = new Map(
    Object.entries(files).map(([path, entry]) => [
      path,
      { real: path, isFile: true, size: 100, mtimeMs: 1000, ...entry },
    ]),
  )
  const grants = createGrants({
    fs: {
      realpath: async (path) => {
        const entry = table.get(path)
        if (!entry) throw missing(path)
        return entry.real
      },
      stat: async (path) => {
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

  const errors: unknown[] = []
  const written: OutputSettings[] = []
  const buttons: boolean[] = []
  const windowActions: string[] = []
  const resizes: unknown[] = []
  const spies = {
    ready: 0,
    errors,
    written,
    buttons,
    windowActions,
    resizes,
  }
  const clock = { now: 5000 }
  const config = memoryConfig()
  const opened: { link: string }[] = []
  const batches: (readonly string[])[] = []
  const sessions: (PageSession | null)[] = []
  const played: Parameters<ServerTitles['play']>[0][] = []
  const server = { opened, batches, sessions, played }
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
    account: {
      set: (session) => {
        server.sessions.push(session)
        return isSessionTaken
      },
    },
    titles: {
      play: async (input) => {
        server.played.push(input)
        return TITLE_REPLY
      },
    },
    links: {
      open: async (input) => {
        server.opened.push(input)
        return NAVIGATE_REPLY
      },
      openBatch: async (links) => {
        server.batches.push(links)
        return NAVIGATE_REPLY
      },
    },
    grants,
    store,
    onReady: () => {
      spies.ready += 1
    },
    onError: (error) => {
      spies.errors.push(error)
    },
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
    controlWindow: (action) => {
      spies.windowActions.push(action)
    },
    startWindowResize: (start) => {
      spies.resizes.push(start)
    },
    moveWindowResize: (move) => {
      spies.resizes.push(move)
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
    spies,
    clock,
    grants,
  }
}

type World = ReturnType<typeof setup>

type GrantedProps = { grants: World['grants']; path: string }

/** The id of a file main granted, as opening a download grants its video. */
const granted = async ({ grants, path }: GrantedProps): Promise<string> => {
  const file = await grants.grant(path)
  if (file === null) throw new Error('expected a grant')
  return file.fileId
}

/** A video in the downloads folder no download names, as one deleted since it was granted. */
const DELETED_DOWNLOAD = `${DOWNLOADED}/13/video.mkv`
/** A video outside the downloads folder. */
const OTHER_VIDEO = '/m/Show/Episode 1.mkv'
const STRANGER = '00000000-0000-4000-8000-0000000000ff'

const downloaded = { [DOWNLOAD_ONE]: {}, [DOWNLOAD_TWO]: {} }

describe('handle', () => {
  it('refuses what is not a request on the list', async () => {
    const { service } = setup({ files: {} })
    const refused = { type: 'refused', message: MESSAGES.unknownRequest } as const
    expect(await service.handle({ type: 'readFile', path: '/etc/hosts' })).toEqual(refused)
    expect(await service.handle('nope')).toEqual(refused)
    expect(await service.handle(null)).toEqual(refused)
  })

  it('refuses a drop of paths, which main no longer opens', async () => {
    const { service, grants } = setup({ files: downloaded })
    expect(await service.handle({ kind: 'drop', paths: [DOWNLOAD_ONE] })).toEqual({
      type: 'refused',
      message: MESSAGES.unknownRequest,
    })
    expect(await service.handle({ type: 'openDialog' })).toEqual({
      type: 'refused',
      message: MESSAGES.unknownRequest,
    })
    // The first id the grants would have drawn, had either been granted.
    expect(grants.fileOf('00000000-0000-4000-8000-000000000001')).toBeNull()
  })

  it('refuses a position or duration that is not a finite number', async () => {
    const { service, grants } = setup({ files: downloaded })
    const fileId = await granted({ grants, path: DOWNLOAD_ONE })
    const refused = { type: 'refused', message: MESSAGES.unknownRequest } as const
    type SaveProps = { position: unknown; duration: unknown }

    const save = ({ position, duration }: SaveProps) =>
      service.handle({ type: 'savePosition', fileId, position, duration })
    expect(await save({ position: Number.NaN, duration: 120 })).toEqual(refused)
    expect(await save({ position: Infinity, duration: 120 })).toEqual(refused)
    expect(await save({ position: 40, duration: Number.NaN })).toEqual(refused)
    expect(await save({ position: '40', duration: 120 })).toEqual(refused)
    expect(await save({ position: 40, duration: 120 })).toEqual({ type: 'done' })
  })

  it('calls onReady and replies done', async () => {
    const { service, spies } = setup({ files: {} })
    expect(await service.handle({ type: 'ready' })).toEqual({
      type: 'done',
    })
    expect(spies.ready).toBe(1)
  })

  it('tells the downloads a page said ready, which plays nothing after a reload mid-play', async () => {
    const { service, reached } = setup({ files: {} })
    await service.handle({ type: 'ready' })
    expect(reached).toEqual([{ name: 'pageReady', input: null }])
  })
})

describe('describeFile', () => {
  type DescribeFileProps = {
    service: ReturnType<typeof setup>['service']
    fileId: string
    queue?: string[]
  }

  const describeFile = ({ service, fileId, queue = [] }: DescribeFileProps) =>
    service.handle({ type: 'describeFile', fileId, queue })

  it('describes a download by its title, its server and its media, and tells the download service it opened', async () => {
    const { service, grants, reached } = setup({ files: downloaded })
    const fileId = await granted({ grants, path: DOWNLOAD_ONE })
    const reply = await describeFile({ service, fileId })
    if (reply.type !== DESKTOP_REPLIES.file) throw new Error(`expected file, got ${reply.type}`)
    expect(reply.file).toEqual({
      fileId,
      label: 'S01E01 Good News',
      folder: 'Downloaded from Vhagar',
      mediaId: 11,
      logo: null,
      resumeAt: 0,
      next: { fileId: expect.any(String), label: 'S01E02 Half Loop', queue: [] },
      tracks: null,
    })
    expect(isOpaqueId(reply.file.next?.fileId ?? '')).toBe(true)
    expect(reached).toEqual([{ name: 'noteOpened', input: { fileId } }])
  })

  it('refuses a granted file that is no download as missing, and opens nothing', async () => {
    const { service, grants, reached } = setup({ files: { [OTHER_VIDEO]: {} } })
    const fileId = await granted({ grants, path: OTHER_VIDEO })
    expect(await describeFile({ service, fileId })).toEqual({
      type: 'refused',
      message: MESSAGES.missing,
    })
    expect(reached).toEqual([])
  })

  it('refuses a deleted download a queue still names as missing', async () => {
    const { service, grants, reached } = setup({
      files: { [DOWNLOAD_ONE]: {}, [DELETED_DOWNLOAD]: {} },
    })
    const fileId = await granted({ grants, path: DELETED_DOWNLOAD })
    expect(await describeFile({ service, fileId })).toEqual({
      type: 'refused',
      message: MESSAGES.missing,
    })
    expect(reached).toEqual([])
  })

  it('prefers a queued download over the next of its group, and hands on the rest of the queue', async () => {
    const { service, grants } = setup({ files: downloaded })
    const one = await granted({ grants, path: DOWNLOAD_ONE })
    const two = await granted({ grants, path: DOWNLOAD_TWO })
    const reply = await describeFile({ service, fileId: two, queue: [one, STRANGER] })
    if (reply.type !== DESKTOP_REPLIES.file) throw new Error(`expected file, got ${reply.type}`)
    expect(reply.file.next).toEqual({ fileId: one, label: 'S01E01 Good News', queue: [STRANGER] })
  })

  it('skips queue entries main no longer knows, and those that are no longer downloads', async () => {
    const { service, grants } = setup({
      files: { ...downloaded, [DELETED_DOWNLOAD]: {}, [OTHER_VIDEO]: {} },
    })
    const one = await granted({ grants, path: DOWNLOAD_ONE })
    const two = await granted({ grants, path: DOWNLOAD_TWO })
    const deleted = await granted({ grants, path: DELETED_DOWNLOAD })
    const other = await granted({ grants, path: OTHER_VIDEO })
    const reply = await describeFile({
      service,
      fileId: two,
      queue: [STRANGER, deleted, other, one, deleted],
    })
    if (reply.type !== DESKTOP_REPLIES.file) throw new Error(`expected file, got ${reply.type}`)
    expect(reply.file.next).toEqual({ fileId: one, label: 'S01E01 Good News', queue: [deleted] })
  })

  it('falls back to the next of its group when no queue entry is a download', async () => {
    const { service, grants } = setup({ files: { ...downloaded, [DELETED_DOWNLOAD]: {} } })
    const fileId = await granted({ grants, path: DOWNLOAD_ONE })
    const deleted = await granted({ grants, path: DELETED_DOWNLOAD })
    const reply = await describeFile({ service, fileId, queue: [STRANGER, deleted] })
    if (reply.type !== DESKTOP_REPLIES.file) throw new Error(`expected file, got ${reply.type}`)
    expect(reply.file.next).toMatchObject({ label: 'S01E02 Half Loop', queue: [] })
  })

  it('offers no next after the last download of its group', async () => {
    const { service, grants } = setup({ files: downloaded })
    const fileId = await granted({ grants, path: DOWNLOAD_TWO })
    const reply = await describeFile({ service, fileId })
    expect(reply.type === DESKTOP_REPLIES.file && reply.file.next).toBeNull()
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

  it("names the pages a video is opened again from, which the app's page has", () => {
    expect(MESSAGES.notOpen).toBe('That video is no longer open. Open it again from Downloads.')
  })
})

describe('savePosition', () => {
  type SaveProps = {
    service: ReturnType<typeof setup>['service']
    fileId: string
    position: number
    duration: number | null
  }

  const save = ({ service, fileId, position, duration }: SaveProps) =>
    service.handle({ type: 'savePosition', fileId, position, duration })
  type Describe1Props = {
    service: ReturnType<typeof setup>['service']
    fileId: string
  }

  const describe1 = ({ service, fileId }: Describe1Props) =>
    service.handle({ type: 'describeFile', fileId, queue: [] })

  it('resumes from the saved position', async () => {
    const { service, grants } = setup({ files: downloaded })
    const fileId = await granted({ grants, path: DOWNLOAD_ONE })
    expect(await save({ service, fileId, position: 40, duration: 120 })).toEqual({ type: 'done' })
    const reply = await describe1({ service, fileId })
    expect(reply.type === DESKTOP_REPLIES.file && reply.file.resumeAt).toBe(40)
  })

  it('starts at 0 once the file changed on disk and was granted again', async () => {
    const { service, grants, table } = setup({ files: downloaded })
    const first = await granted({ grants, path: DOWNLOAD_ONE })
    await save({ service, fileId: first, position: 40, duration: 120 })
    const entry = table.get(DOWNLOAD_ONE)
    if (!entry) throw new Error('fixture missing')
    table.set(DOWNLOAD_ONE, { ...entry, mtimeMs: 2000 })
    const again = await granted({ grants, path: DOWNLOAD_ONE })
    const reply = await describe1({ service, fileId: again })
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
    const { service, grants, reached, resumeAt } = setup({ files: downloaded })
    const fileId = await granted({ grants, path: DOWNLOAD_ONE })
    await save({ service, fileId, position: 40, duration: null })
    expect(reached).toEqual([
      { name: 'notePosition', input: { fileId, position: 40, duration: null } },
    ])
    expect(resumeAt).toEqual([40])
  })

  it("starts a download with no local spot at the server's spot, and at the local one once saved", async () => {
    const { service, grants } = setup({ files: { [DOWNLOAD_ONE]: {} }, serverPosition: 4200 })
    const fileId = await granted({ grants, path: DOWNLOAD_ONE })
    const fresh = await describe1({ service, fileId })
    expect(fresh.type === 'file' && fresh.file.resumeAt).toBe(4200)
    await save({ service, fileId, position: 100, duration: 3000 })
    const saved = await describe1({ service, fileId })
    expect(saved.type === 'file' && saved.file.resumeAt).toBe(100)
  })

  it('starts a download at 0 when the server had no spot for it', async () => {
    const { service, grants } = setup({ files: { [DOWNLOAD_ONE]: {} } })
    const fileId = await granted({ grants, path: DOWNLOAD_ONE })
    const reply = await describe1({ service, fileId })
    expect(reply.type === 'file' && reply.file.resumeAt).toBe(0)
  })

  it('stamps the save with the clock', async () => {
    const { service, grants, store, clock } = setup({ files: downloaded })
    const fileId = await granted({ grants, path: DOWNLOAD_ONE })
    clock.now = 9000
    await save({ service, fileId, position: 40, duration: null })
    expect(store.read().resume[0]).toMatchObject({ position: 40, duration: null, playedAt: 9000 })
  })
})

describe('saveTracks', () => {
  type SaveTracksProps = {
    service: ReturnType<typeof setup>['service']
    fileId: string
    audio: unknown
    subtitle: unknown
  }

  const saveTracks = ({ service, fileId, audio, subtitle }: SaveTracksProps) =>
    service.handle({ type: 'saveTracks', fileId, audio, subtitle })
  type DescribingProps = {
    service: ReturnType<typeof setup>['service']
    fileId: string
  }

  const describing = ({ service, fileId }: DescribingProps) =>
    service.handle({ type: 'describeFile', fileId, queue: [] })

  it('describes a file with no pick as tracks null', async () => {
    const { service, grants } = setup({ files: downloaded })
    const fileId = await granted({ grants, path: DOWNLOAD_ONE })
    const reply = await describing({ service, fileId })
    expect(reply.type === DESKTOP_REPLIES.file && reply.file.tracks).toBeNull()
  })

  it('stores the pick and hands it back on the next describeFile', async () => {
    const { service, grants, store, clock } = setup({ files: downloaded })
    const fileId = await granted({ grants, path: DOWNLOAD_ONE })
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
      { path: DOWNLOAD_ONE, audio: 1, subtitle: 'embedded-0', pickedAt: 7000 },
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
    const { service, grants, store } = setup({ files: downloaded })
    const fileId = await granted({ grants, path: DOWNLOAD_ONE })
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

describe('windowControl', () => {
  it('passes the action on and replies done', async () => {
    const { service, spies } = setup({ files: {} })
    expect(await service.handle({ type: 'windowControl', action: 'maximize' })).toEqual({
      type: 'done',
    })
    await service.handle({ type: 'windowControl', action: 'close' })
    expect(spies.windowActions).toEqual(['maximize', 'close'])
  })

  it('refuses an action it does not know', async () => {
    const { service, spies } = setup({ files: {} })
    expect(await service.handle({ type: 'windowControl', action: 'hide' })).toEqual({
      type: 'refused',
      message: MESSAGES.unknownRequest,
    })
    expect(spies.windowActions).toEqual([])
  })
})

describe('window resize', () => {
  it('passes a drag on a resize handle on as an edge and screen points', async () => {
    const { service, spies } = setup({ files: {} })
    expect(
      await service.handle({ type: 'startWindowResize', edge: 'bottomRight', x: 900, y: 700 }),
    ).toEqual({ type: 'done' })
    await service.handle({ type: 'moveWindowResize', x: 940, y: 690 })
    expect(spies.resizes).toEqual([
      { edge: 'bottomRight', at: { x: 900, y: 700 } },
      { to: { x: 940, y: 690 } },
    ])
  })

  it('refuses an edge it does not know', async () => {
    const { service, spies } = setup({ files: {} })
    expect(await service.handle({ type: 'startWindowResize', edge: 'middle', x: 0, y: 0 })).toEqual(
      { type: 'refused', message: MESSAGES.unknownRequest },
    )
    expect(spies.resizes).toEqual([])
  })
})

describe('windowButtons', () => {
  it('passes the visibility on and replies done', async () => {
    const { service, spies } = setup({ files: {} })
    expect(await service.handle({ type: 'windowButtons', isVisible: false })).toEqual({
      type: 'done',
    })
    await service.handle({ type: 'windowButtons', isVisible: true })
    expect(spies.buttons).toEqual([false, true])
  })

  it('refuses a visibility that is not a boolean', async () => {
    const { service, spies } = setup({ files: {} })
    expect(await service.handle({ type: 'windowButtons', isVisible: 'yes' })).toEqual({
      type: 'refused',
      message: MESSAGES.unknownRequest,
    })
    expect(spies.buttons).toEqual([])
  })
})

describe('output', () => {
  it('answers readOutput with what the output dependency reads', async () => {
    const { service } = setup({ files: {} })
    expect(await service.handle({ type: 'readOutput' })).toEqual({
      type: 'output',
      ...OUTPUT_ANSWER,
    })
  })

  it('answers a failing read with a refusal, not a rejection, and reports the error', async () => {
    const { service, spies } = setup({ files: {}, failOutputRead: true })
    expect(await service.handle({ type: 'readOutput' })).toEqual({
      type: 'refused',
      message: MESSAGES.failed,
    })
    expect(spies.errors).toHaveLength(1)
  })

  it('writes the settings rebuilt from the known fields, with passthrough deduplicated and ordered', async () => {
    const { service, spies } = setup({ files: {} })
    const reply = await service.handle({
      type: 'writeOutput',
      output: {
        profile: 'passthrough',
        device: 'coreaudio/abc',
        passthrough: ['dts', 'ac3', 'dts'],
        spatial: false,
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
    expect(await service.handle({ type: 'writeOutput', output: { profile: 'pcm' } })).toEqual({
      type: 'refused',
      message: MESSAGES.unknownRequest,
    })
    expect(spies.written).toEqual([])
  })

  it('answers a failing write with a refusal, not a rejection, and reports the error', async () => {
    const { service, spies } = setup({ files: {}, failOutputWrite: true })
    expect(
      await service.handle({
        type: 'writeOutput',
        output: { profile: 'pcm', device: 'auto', passthrough: [], spatial: false },
      }),
    ).toEqual({ type: 'refused', message: MESSAGES.failed })
    expect(spies.errors).toHaveLength(1)
  })
})

describe('the server', () => {
  type Service = ReturnType<typeof setup>['service']
  type AskProps = { service: Service; request: unknown }

  const ask = ({ service, request }: AskProps) => service.handle(request)
  const SESSION = { accessToken: 'header.payload.signature', userId: 'ada' }

  it("hands the page's session to the account, and its sign out as null", async () => {
    const { service, server } = setup({ files: {} })
    expect(
      await ask({ service, request: { type: DESKTOP_REQUESTS.accountToken, session: SESSION } }),
    ).toEqual({ type: DESKTOP_REPLIES.done })
    expect(
      await ask({ service, request: { type: DESKTOP_REQUESTS.accountToken, session: null } }),
    ).toEqual({ type: DESKTOP_REPLIES.done })
    expect(server.sessions).toEqual([SESSION, null])
  })

  it('refuses a session the account will not take', async () => {
    const { service } = setup({ files: {}, isSessionTaken: false })
    expect(
      await ask({ service, request: { type: DESKTOP_REQUESTS.accountToken, session: SESSION } }),
    ).toEqual({ type: DESKTOP_REPLIES.refused, message: MESSAGES.badSession })
  })

  it('refuses a session with no account, without handing it on', async () => {
    const { service, server } = setup({ files: {} })
    expect(
      await ask({
        service,
        request: { type: DESKTOP_REQUESTS.accountToken, session: { accessToken: 'x' } },
      }),
    ).toEqual({ type: DESKTOP_REPLIES.refused, message: MESSAGES.unknownRequest })
    expect(server.sessions).toEqual([])
  })

  it('asks the downloads about a target on the one server', async () => {
    const { service, reached } = setup({ files: {} })
    const target = { kind: DOWNLOAD_TARGET_KINDS.item, itemId: 4 } as const
    expect(await ask({ service, request: { type: DESKTOP_REQUESTS.askDownload, target } })).toEqual(
      { type: DESKTOP_REPLIES.done },
    )
    expect(reached).toEqual([{ name: 'ask', input: { target } }])
  })

  it('plays a title through the server titles, and answers what the player needs', async () => {
    const { service, server } = setup({ files: {} })
    expect(
      await ask({
        service,
        request: { type: DESKTOP_REQUESTS.playTitle, mediaId: 7, at: 30, next: [8] },
      }),
    ).toEqual(TITLE_REPLY)
    expect(server.played).toEqual([{ mediaId: 7, at: 30, next: [8] }])
  })

  it('opens a link the page was handed', async () => {
    const { service, server } = setup({ files: {} })
    const link = 'https://raven.example/watch/7'
    expect(await ask({ service, request: { type: DESKTOP_REQUESTS.openLink, link } })).toEqual(
      NAVIGATE_REPLY,
    )
    expect(server.opened).toEqual([{ link }])
  })

  it('forwards a batch from main to the opener', async () => {
    const { service, server } = setup({ files: {} })
    const links = ['raven://play?server=https://raven.example&media=7', 'raven://x']
    expect(await service.openLinks(links)).toEqual(NAVIGATE_REPLY)
    expect(server.batches).toEqual([links])
  })
})

describe('updates', () => {
  type Service = ReturnType<typeof setup>['service']
  type AskProps = { service: Service; request: unknown }

  const ask = ({ service, request }: AskProps) => service.handle(request)
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
  type AskProps = { service: Service; request: unknown }

  const ask = ({ service, request }: AskProps) => service.handle(request)

  it('hands a confirmation to the download service and answers its list', async () => {
    const { service, reached } = setup({ files: {} })
    expect(
      await ask({
        service,
        request: { type: 'confirmDownload', askId: ASK_ID, shouldAutoDelete: true },
      }),
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
      { type: 'setDownloadDefaults', shouldAutoDelete: true },
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
        request: { type: 'confirmDownload', askId: '../downloads.json', shouldAutoDelete: false },
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
      { type: 'setDownloadAutoDelete', downloadId: ASK_ID, shouldAutoDelete: true },
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

  it('tells the download service the page left a file', async () => {
    const { service, reached } = setup({ files: {} })
    expect(await ask({ service, request: { type: 'playbackLeft', fileId: ASK_ID } })).toEqual({
      type: 'done',
    })
    expect(reached).toEqual([{ name: 'playbackLeft', input: { fileId: ASK_ID } }])
  })

  it('refuses playbackLeft naming its file by anything but an opaque id', async () => {
    const { service, reached } = setup({ files: {} })
    expect(
      await ask({ service, request: { type: 'playbackLeft', fileId: '/Movies/x.mkv' } }),
    ).toEqual({ type: 'refused', message: MESSAGES.unknownRequest })
    expect(reached).toEqual([])
  })

  it('refuses openDownload naming its download by anything but an opaque id', async () => {
    const { service, reached } = setup({ files: {} })
    expect(
      await ask({ service, request: { type: 'openDownload', downloadId: '../downloads' } }),
    ).toEqual({ type: 'refused', message: MESSAGES.unknownRequest })
    expect(reached).toEqual([])
  })
})
