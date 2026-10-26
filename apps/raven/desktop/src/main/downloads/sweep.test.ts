import { DOWNLOAD_STATUS_KINDS } from '@raven/core'
import { describe, expect, it } from 'bun:test'
import {
  EMPTY_DOWNLOADS,
  NO_PENDING,
  type DownloadEntry,
  type DownloadsState,
} from '@/main/downloads/downloadState'
import type { DownloadsStore } from '@/main/downloads/downloadStore'
import { removeFolder, sweepDownloads } from '@/main/downloads/sweep'
import { fakeDisk, fsError } from '@/main/test/downloadFakes'

const SERVER_ID = '6f1c1c0e-3b0a-4f4e-8a55-0d2f3c5b7e11'
const OTHER_SERVER_ID = '7c9e6679-7425-40de-944b-e07fc1f90ae7'
const GONE_SERVER_ID = '3b241101-e2bb-4255-8caf-4136c566a962'
const USER_DATA = '/data'
const DOWNLOADS = '/data/downloads'

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

type SetupProps = {
  entries?: DownloadEntry[]
  disk?: Record<string, number>
}

const setup = ({ entries = [], disk = {} }: SetupProps = {}) => {
  const store = memoryStore({ ...EMPTY_DOWNLOADS, entries })
  const drive = fakeDisk(disk)
  const warnings: string[] = []
  type SweepProps = { wasSetAside: boolean }

  const sweep = ({ wasSetAside }: SweepProps) =>
    sweepDownloads({
      store,
      fs: drive.fs,
      userData: USER_DATA,
      warn: (message) => warnings.push(message),
      wasSetAside,
    })
  return { store, drive, warnings, sweep }
}

describe('sweepDownloads', () => {
  it('sweeps the folders no download names, a whole server of them included, and keeps the rest', async () => {
    const world = setup({
      entries: [
        entryFor(1),
        entryFor(9, { serverId: OTHER_SERVER_ID, status: { kind: DOWNLOAD_STATUS_KINDS.ready } }),
      ],
      disk: {
        [partOf(1)]: 4,
        [`${dirOf(7)}/video.mkv`]: 8,
        [`${dirOf(9, OTHER_SERVER_ID)}/video.mkv`]: 8,
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
    expect(world.drive.files.has(`${dirOf(9, OTHER_SERVER_ID)}/video.mkv`)).toBe(true)
    expect(world.drive.files.has(`${DOWNLOADS}/.DS_Store`)).toBe(true)
    expect(world.store.read().entries.map(({ downloadId }) => downloadId)).toEqual([
      idOf(1),
      idOf(9),
    ])
    const log = world.warnings.join('\n')
    expect(log).not.toContain(DOWNLOADS)
    expect(log).not.toContain(GONE_SERVER_ID)
    expect(world.warnings).toHaveLength(2)
  })

  it('keeps every folder, saying so once, when the downloads list was set aside', async () => {
    const world = setup({
      disk: {
        [partOf(1)]: 4,
        [`${dirOf(7)}/video.mkv`]: 8,
        [`${dirOf(3, GONE_SERVER_ID)}/video.mkv`]: 8,
      },
    })
    await world.sweep({ wasSetAside: true })
    expect(world.drive.removed).toEqual([])
    expect(world.drive.sizeOf(`${dirOf(7)}/video.mkv`)).toBe(8)
    expect(world.drive.sizeOf(`${dirOf(3, GONE_SERVER_ID)}/video.mkv`)).toBe(8)
    expect(world.warnings).toHaveLength(1)
    expect(world.warnings[0]).not.toContain(DOWNLOADS)
  })

  it('sweeps nothing when there is no downloads folder yet', async () => {
    const world = setup({ entries: [entryFor(1)] })
    await world.sweep({ wasSetAside: false })
    expect(world.drive.removed).toEqual([])
    expect(world.warnings).toEqual([])
  })

  it('never rejects, and says why it could not sweep', async () => {
    const world = setup({ disk: { [`${dirOf(7)}/video.mkv`]: 8 } })
    const sweeping = sweepDownloads({
      store: {
        ...world.store,
        read: () => {
          throw new Error('the list is gone')
        },
      },
      fs: world.drive.fs,
      userData: USER_DATA,
      warn: (message) => world.warnings.push(message),
      wasSetAside: false,
    })
    expect(await sweeping).toBeUndefined()
    expect(world.warnings).toEqual(['Raven could not sweep its downloads: the list is gone'])
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
