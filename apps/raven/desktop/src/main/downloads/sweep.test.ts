import { describe, expect, it } from 'bun:test'
import type { ServerEntry } from '@/main/desktopConfig'
import {
  EMPTY_DOWNLOADS,
  NO_PENDING,
  type DownloadEntry,
  type DownloadsState,
  type Owed,
} from '@/main/downloads/downloadState'
import type { DownloadsStore } from '@/main/downloads/downloadStore'
import { removeFolder, sweepDownloads } from '@/main/downloads/sweep'
import { fakeDisk, fsError } from '@/main/test/downloadFakes'

const SERVER_ID = '6f1c1c0e-3b0a-4f4e-8a55-0d2f3c5b7e11'
const OTHER_SERVER_ID = '7c9e6679-7425-40de-944b-e07fc1f90ae7'
const GONE_SERVER_ID = '3b241101-e2bb-4255-8caf-4136c566a962'
const USER_DATA = '/data'
const DOWNLOADS = '/data/downloads'

const SERVERS: ServerEntry[] = [
  { id: SERVER_ID, origin: 'https://vhagar.example', name: 'Vhagar', addedAt: 1 },
  { id: OTHER_SERVER_ID, origin: 'https://syrax.example', name: 'Syrax', addedAt: 2 },
]

const idOf = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const dirOf = (n: number, serverId = SERVER_ID): string => `${DOWNLOADS}/${serverId}/${n}`
const partOf = (n: number, serverId = SERVER_ID): string => `${dirOf(n, serverId)}/video.mkv.part`

const entryFor = (n: number, overrides: Partial<DownloadEntry> = {}): DownloadEntry => ({
  downloadId: idOf(n),
  serverId: SERVER_ID,
  mediaId: n,
  label: `Episode ${n}`,
  group: { kind: 'season', key: 'show:4', title: 'Severance', order: n },
  container: 'mkv',
  size: 8,
  duration: 3000,
  watchedPercent: 90,
  sidecars: [],
  status: { kind: 'queued' },
  autoDelete: false,
  watchedAt: null,
  serverPosition: 0,
  pending: NO_PENDING,
  createdAt: 1,
  ...overrides,
})

const memoryStore = (initial: DownloadsState): DownloadsStore => {
  const state = { value: initial }
  return {
    read: () => state.value,
    update: (change) => {
      state.value = change(state.value)
    },
    flush: async () => undefined,
    isDirty: () => false,
  }
}

const setup = ({
  entries = [],
  owed = [],
  disk = {},
  servers = SERVERS,
}: {
  entries?: DownloadEntry[]
  owed?: Owed[]
  disk?: Record<string, number>
  servers?: ServerEntry[]
} = {}) => {
  const store = memoryStore({ ...EMPTY_DOWNLOADS, entries, owed })
  const drive = fakeDisk(disk)
  const warnings: string[] = []
  const dropped: (readonly DownloadEntry[])[] = []
  const sweep = ({ wasSetAside }: { wasSetAside: boolean }) =>
    sweepDownloads({
      store,
      fs: drive.fs,
      servers: () => servers,
      userData: USER_DATA,
      warn: (message) => warnings.push(message),
      onRemoved: (removed) => dropped.push(removed),
      wasSetAside,
    })
  return { store, drive, warnings, dropped, sweep }
}

describe('sweepDownloads', () => {
  it('sweeps the folders no download names and the servers raven player no longer keeps', async () => {
    const world = setup({
      entries: [entryFor(1), entryFor(9, { serverId: GONE_SERVER_ID })],
      disk: {
        [partOf(1)]: 4,
        [`${dirOf(7)}/video.mkv`]: 8,
        [`${dirOf(3, GONE_SERVER_ID)}/video.mkv`]: 8,
        [`${DOWNLOADS}/.DS_Store`]: 1,
        [`${DOWNLOADS}/${SERVER_ID}/notes`]: 1,
      },
    })
    await world.sweep({ wasSetAside: false })
    expect(world.drive.removed.toSorted()).toEqual(
      [`${DOWNLOADS}/${GONE_SERVER_ID}`, dirOf(7)].toSorted(),
    )
    expect(world.drive.files.has(partOf(1))).toBe(true)
    expect(world.drive.files.has(`${DOWNLOADS}/.DS_Store`)).toBe(true)
    expect(world.store.read().entries.map(({ downloadId }) => downloadId)).toEqual([idOf(1)])
    const log = world.warnings.join('\n')
    expect(log).not.toContain(DOWNLOADS)
    expect(log).not.toContain(GONE_SERVER_ID)
    expect(world.warnings).toHaveLength(3)
  })

  it('says which downloads it dropped', async () => {
    const world = setup({ entries: [entryFor(1), entryFor(9, { serverId: GONE_SERVER_ID })] })
    await world.sweep({ wasSetAside: false })
    expect(world.dropped.map((entries) => entries.map(({ downloadId }) => downloadId))).toEqual([
      [idOf(9)],
    ])
  })

  it('finishes the removal of a server no longer kept: its downloads owe it nothing and its owed goes', async () => {
    const pending = { play: true, position: 750, furthest: 750, at: 5 }
    const kept: Owed = { serverId: SERVER_ID, mediaId: 4, pending }
    const world = setup({
      entries: [entryFor(1, { pending }), entryFor(9, { serverId: GONE_SERVER_ID, pending })],
      owed: [kept, { serverId: GONE_SERVER_ID, mediaId: 3, pending }],
    })
    await world.sweep({ wasSetAside: false })
    expect(world.store.read().entries.map(({ downloadId }) => downloadId)).toEqual([idOf(1)])
    expect(world.store.read().owed).toEqual([kept])
  })

  it('drops nothing and removes no server folder when the config holds no server', async () => {
    const world = setup({
      servers: [],
      entries: [entryFor(1), entryFor(9, { serverId: GONE_SERVER_ID })],
      disk: {
        [partOf(1)]: 4,
        [`${dirOf(7)}/video.mkv`]: 8,
        [`${dirOf(3, GONE_SERVER_ID)}/video.mkv`]: 8,
      },
    })
    await world.sweep({ wasSetAside: false })
    expect(world.drive.removed).toEqual([])
    expect(world.store.read().entries).toHaveLength(2)
    expect(world.dropped).toEqual([])
    expect(world.warnings).toEqual([])
  })

  it('keeps every media folder of a kept server, saying so once, when the downloads list was set aside', async () => {
    const world = setup({
      disk: {
        [partOf(1)]: 4,
        [`${dirOf(7)}/video.mkv`]: 8,
        [`${dirOf(3, OTHER_SERVER_ID)}/video.mkv`]: 8,
      },
    })
    await world.sweep({ wasSetAside: true })
    expect(world.drive.removed).toEqual([])
    expect(world.drive.sizeOf(`${dirOf(7)}/video.mkv`)).toBe(8)
    expect(world.drive.sizeOf(`${dirOf(3, OTHER_SERVER_ID)}/video.mkv`)).toBe(8)
    expect(world.warnings).toHaveLength(1)
    expect(world.warnings[0]).not.toContain(DOWNLOADS)
  })

  it('still removes the folder of a server raven player no longer keeps when the list was set aside', async () => {
    const world = setup({
      disk: {
        [`${dirOf(7)}/video.mkv`]: 8,
        [`${dirOf(3, GONE_SERVER_ID)}/video.mkv`]: 8,
      },
    })
    await world.sweep({ wasSetAside: true })
    expect(world.drive.removed).toEqual([`${DOWNLOADS}/${GONE_SERVER_ID}`])
    expect(world.drive.sizeOf(`${dirOf(7)}/video.mkv`)).toBe(8)
  })

  it('sweeps nothing when there is no downloads folder yet', async () => {
    const world = setup({ entries: [entryFor(1)] })
    await world.sweep({ wasSetAside: false })
    expect(world.drive.removed).toEqual([])
    expect(world.warnings).toEqual([])
  })

  it('never rejects, and says why it could not sweep', async () => {
    const world = setup()
    const sweeping = sweepDownloads({
      store: world.store,
      fs: world.drive.fs,
      servers: () => {
        throw new Error('the config is gone')
      },
      userData: USER_DATA,
      warn: (message) => world.warnings.push(message),
      onRemoved: () => undefined,
      wasSetAside: false,
    })
    expect(await sweeping).toBeUndefined()
    expect(world.warnings).toEqual([
      'raven player could not sweep its downloads: the config is gone',
    ])
  })
})

describe('removeFolder', () => {
  it('only logs a folder that would not go, naming no path', async () => {
    const warnings: string[] = []
    await removeFolder({
      fs: {
        rm: async () => {
          throw fsError({ code: 'EBUSY', syscall: 'rm' })
        },
      },
      warn: (message) => warnings.push(message),
      path: `${DOWNLOADS}/${SERVER_ID}`,
      what: "a removed server's downloads",
    })
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain("a removed server's downloads")
    expect(warnings[0]).not.toContain(DOWNLOADS)
  })
})
