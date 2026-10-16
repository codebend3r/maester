import { describe, expect, it } from 'bun:test'
import { dirname, basename } from 'node:path'
import { isOpaqueId, MAX_QUEUE } from '@/shared/protocol'
import { createGrants } from '@/main/grants'
import { createStateStore, type StateFs } from '@/main/stateStore'
import { EMPTY_STATE } from '@/main/playerState'
import { createDesktopService, MESSAGES } from '@/main/desktopService'

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

const setup = ({
  files,
  dialog = [],
  addRecentDocument,
}: {
  files: Record<string, Partial<Entry>>
  dialog?: string[] | Error
  addRecentDocument?: (path: string) => void
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
    writeFile: async (path, data) => {
      disk.set(path, data)
    },
    rename: async (from, to) => {
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
  const spies = { recentDocuments, cleared: 0, ready: 0, dialogCalls: 0, errors }
  const clock = { now: 5000 }
  // A second sequence for recents ids, offset so it cannot collide with the grants' ids.
  const recentId = sequentialId()
  const service = createDesktopService({
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
      const entry = table.get(path)
      if (!entry) throw missing(path)
      return { size: entry.size, mtimeMs: entry.mtimeMs }
    },
    onError: (error) => {
      spies.errors.push(error)
    },
    newId: () => `10${recentId().slice(2)}`,
    now: () => clock.now,
  })
  return { service, store, table, stats, spies, clock, grants }
}

const idOf = (reply: Awaited<ReturnType<ReturnType<typeof setup>['service']['openPaths']>>) => {
  if (reply.type !== 'play') throw new Error(`expected play, got ${reply.type}`)
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
    const save = (position: unknown, duration: unknown) =>
      service.handle({
        kind: 'page',
        request: { type: 'savePosition', fileId: target.fileId, position, duration },
      })
    expect(await save(Number.NaN, 120)).toEqual(refused)
    expect(await save(Infinity, 120)).toEqual(refused)
    expect(await save(40, Number.NaN)).toEqual(refused)
    expect(await save('40', 120)).toEqual(refused)
    expect(await save(40, 120)).toEqual({ type: 'done' })
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
  const describeFile = (
    service: ReturnType<typeof setup>['service'],
    fileId: string,
    queue: string[] = [],
  ) => service.handle({ kind: 'page', request: { type: 'describeFile', fileId, queue } })

  it('describes the file, finds the next in its folder and records the open', async () => {
    const { service, spies, store } = setup({ files: show })
    const { fileId } = idOf(await service.openPaths(['/m/Show/Episode 1.mkv']))
    const reply = await describeFile(service, fileId)
    if (reply.type !== 'file') throw new Error(`expected file, got ${reply.type}`)
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
    const reply = await describeFile(service, fileId)
    expect(reply.type === 'file' && reply.file.next).toBeNull()
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
    const reply = await describeFile(service, target.fileId, target.queue)
    if (reply.type !== 'file') throw new Error('expected file')
    expect(reply.file.next!.label).toBe('Film')
    expect(reply.file.next!.queue).toEqual(target.queue.slice(1))
  })

  it('skips queue entries main no longer knows', async () => {
    const { service } = setup({ files: show })
    const target = idOf(
      await service.openPaths(['/m/Show/Episode 1.mkv', '/m/Show/Episode 10.mkv']),
    )
    const stranger = '00000000-0000-4000-8000-0000000000ff'
    const reply = await describeFile(service, target.fileId, [stranger, ...target.queue])
    if (reply.type !== 'file') throw new Error('expected file')
    expect(reply.file.next!.label).toBe('Episode 10')
    expect(reply.file.next!.queue).toEqual([])
  })

  it('falls back to the folder when no queue entry is known', async () => {
    const { service } = setup({ files: show })
    const { fileId } = idOf(await service.openPaths(['/m/Show/Episode 1.mkv']))
    const stranger = '00000000-0000-4000-8000-0000000000ff'
    const reply = await describeFile(service, fileId, [stranger])
    expect(reply.type === 'file' && reply.file.next!.label).toBe('Episode 2')
  })

  it('walks the folder of the real file when the opened path is a symlink', async () => {
    const { service } = setup({
      files: { ...show, '/links/watch.mkv': { real: '/m/Show/Episode 1.mkv' } },
    })
    const { fileId } = idOf(await service.openPaths(['/links/watch.mkv']))
    const reply = await describeFile(service, fileId)
    if (reply.type !== 'file') throw new Error('expected file')
    expect(reply.file.folder).toBe('Show')
    expect(reply.file.next!.label).toBe('Episode 2')
  })

  it('is refused notOpen for an id that was never granted', async () => {
    const { service } = setup({ files: {} })
    expect(await describeFile(service, '00000000-0000-4000-8000-0000000000aa')).toEqual({
      type: 'refused',
      message: MESSAGES.notOpen,
    })
  })
})

describe('savePosition', () => {
  const save = (
    service: ReturnType<typeof setup>['service'],
    fileId: string,
    position: number,
    duration: number | null,
  ) =>
    service.handle({ kind: 'page', request: { type: 'savePosition', fileId, position, duration } })
  const describe1 = (service: ReturnType<typeof setup>['service'], fileId: string) =>
    service.handle({ kind: 'page', request: { type: 'describeFile', fileId, queue: [] } })

  it('resumes from the saved position', async () => {
    const { service } = setup({ files: show })
    const { fileId } = idOf(await service.openPaths(['/m/Show/Episode 1.mkv']))
    expect(await save(service, fileId, 40, 120)).toEqual({ type: 'done' })
    const reply = await describe1(service, fileId)
    expect(reply.type === 'file' && reply.file.resumeAt).toBe(40)
  })

  it('starts at 0 once the file changed on disk and was granted again', async () => {
    const { service, table } = setup({ files: show })
    const first = idOf(await service.openPaths(['/m/Show/Episode 1.mkv']))
    await save(service, first.fileId, 40, 120)
    const entry = table.get('/m/Show/Episode 1.mkv')
    if (!entry) throw new Error('fixture missing')
    table.set('/m/Show/Episode 1.mkv', { ...entry, mtimeMs: 2000 })
    const again = idOf(await service.openPaths(['/m/Show/Episode 1.mkv']))
    const reply = await describe1(service, again.fileId)
    expect(reply.type === 'file' && reply.file.resumeAt).toBe(0)
  })

  it('is refused notOpen for an id that was never granted', async () => {
    const { service } = setup({ files: {} })
    expect(await save(service, '00000000-0000-4000-8000-0000000000aa', 40, 120)).toEqual({
      type: 'refused',
      message: MESSAGES.notOpen,
    })
  })

  it('stamps the save with the clock', async () => {
    const { service, store, clock } = setup({ files: show })
    const { fileId } = idOf(await service.openPaths(['/m/Show/Episode 1.mkv']))
    clock.now = 9000
    await save(service, fileId, 40, null)
    expect(store.read().resume[0]).toMatchObject({ position: 40, duration: null, playedAt: 9000 })
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
    if (reply.type !== 'recents') throw new Error(`expected recents, got ${reply.type}`)
    return reply.recents
  }
  const open = async (service: ReturnType<typeof setup>['service'], path: string) => {
    const { fileId } = idOf(await service.openPaths([path]))
    await service.handle({ kind: 'page', request: { type: 'describeFile', fileId, queue: [] } })
    return fileId
  }

  it('lists the newest first with the share watched and no path', async () => {
    const { service, clock } = setup({ files: show })
    const first = await open(service, '/m/Show/Episode 1.mkv')
    await service.handle({
      kind: 'page',
      request: { type: 'savePosition', fileId: first, position: 40, duration: 120 },
    })
    clock.now = 6000
    await open(service, '/m/Show/Episode 2.mkv')
    const list = await recents(service)
    expect(list.map((recent) => recent.label)).toEqual(['Episode 2', 'Episode 1'])
    expect(list.map((recent) => recent.watched)).toEqual([null, expect.any(Number)])
    expect(list[1]!.watched).toBeCloseTo(0.33, 2)
    expect(list.every((recent) => recent.from === 'Show')).toBe(true)
    expect(list.every((recent) => isOpaqueId(recent.recentId))).toBe(true)
    expect(JSON.stringify(list)).not.toContain('/')
  })

  it('keeps a recent id stable for the session', async () => {
    const { service } = setup({ files: show })
    await open(service, '/m/Show/Episode 1.mkv')
    const [one] = await recents(service)
    const [two] = await recents(service)
    expect(one!.recentId).toBe(two!.recentId)
  })

  it('opens a recent, and keeps it when the file has gone', async () => {
    const { service, table } = setup({ files: show })
    await open(service, '/m/Show/Episode 1.mkv')
    const [recent] = await recents(service)
    if (!recent) throw new Error('no recent')
    const reply = await service.handle({
      kind: 'page',
      request: { type: 'openRecent', recentId: recent.recentId },
    })
    expect(reply.type === 'play' && reply.target.queue).toEqual([])
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
    await open(service, '/m/Show/Episode 1.mkv')
    await open(service, '/m/Show/Episode 2.mkv')
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
    await open(service, '/m/Show/Episode 1.mkv')
    await open(service, '/m/Show/Episode 2.mkv')
    await open(service, '/m/Show/Episode 10.mkv')
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
    const fileId = await open(service, '/m/Show/Episode 1.mkv')
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
    const fileId = await open(service, '/m/Show/Episode 1.mkv')
    const save = (duration: number | null) =>
      service.handle({
        kind: 'page',
        request: { type: 'savePosition', fileId, position: 40, duration },
      })
    await save(120)
    await save(null)
    expect((await recents(service))[0]!.watched).toBeCloseTo(0.33, 2)
  })

  it('shows no progress for a recent whose file has gone', async () => {
    const { service, table } = setup({ files: show })
    const fileId = await open(service, '/m/Show/Episode 1.mkv')
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
