import { createDownloadPlayback } from '@/main/downloads/playback'
import {
  EMPTY_DOWNLOADS,
  NO_PENDING,
  type DownloadEntry,
  type DownloadsState,
} from '@/main/downloads/downloadState'
import { createGrants } from '@/main/grants'
import { EMPTY_STATE, type PlayerState } from '@/main/playerState'
import type { JsonStore } from '@/main/stateStore'

export const SERVER_ID = '6f1c1c0e-3b0a-4f4e-8a55-0d2f3c5b7e11'
export const OTHER_SERVER_ID = '7c9e6679-7425-40de-944b-e07fc1f90ae7'
export const USER_DATA = '/data'
export const DOWNLOADS = `${USER_DATA}/downloads`
export const NOW = 1_700_000_000_000
/** When every file on the fake disk was last changed. */
export const MTIME = 1_600_000_000_000
export const GIB = 1024 ** 3
export const ID = '0f8fad5b-d9cb-469f-a165-70867728950e'
export const ACCOUNT_A = '30000000-0000-4000-8000-00000000000a'

export type Video = { size: number; mtimeMs: number }

export const FILE: Video = { size: 2 * GIB, mtimeMs: MTIME }

export const entryFor = (overrides: Partial<DownloadEntry>): DownloadEntry => ({
  downloadId: ID,
  serverId: SERVER_ID,
  mediaId: 11,
  label: 'S01E01 Good News',
  group: { kind: 'season', key: 'show:4', title: 'Severance', order: 10_001 },
  container: 'mkv',
  size: 2 * GIB,
  duration: 3000,
  watchedPercent: 90,
  sidecars: [],
  status: { kind: 'ready' },
  autoDelete: false,
  watchedAt: null,
  serverPosition: 0,
  pending: NO_PENDING,
  createdAt: NOW - 1000,
  track: undefined,
  ...overrides,
})

/** A store held in memory that never writes a file. */
const memoryStore = <T>(initial: T): JsonStore<T> => {
  const held = { value: initial }
  return {
    read: () => held.value,
    update: (apply) => {
      held.value = apply(held.value)
    },
    flush: async () => undefined,
    isDirty: () => false,
  }
}

const missing = (): Error => Object.assign(new Error('ENOENT'), { code: 'ENOENT' })

const fileIds = (): (() => string) => {
  const counter = { n: 0 }
  return () => {
    counter.n += 1
    return `20000000-0000-4000-8000-${String(counter.n).padStart(12, '0')}`
  }
}

type SetupProps = {
  entries?: DownloadEntry[]
  /** Finished videos by path. */
  videos?: Record<string, Video>
  player?: PlayerState
  /** The account signed in to the server, as the page's session names it. */
  accountId?: string | null
  /** The last account signed in to the server, as the config keeps it. */
  lastAccountId?: string | null
}

/** A download playback over memory: its store, grants and disk, and what it told and warned. */
export const setup = ({
  entries = [],
  videos = {},
  player = EMPTY_STATE,
  accountId = ACCOUNT_A,
  lastAccountId = null,
}: SetupProps = {}) => {
  const signedIn = { accountId, lastAccountId }
  const store = memoryStore<DownloadsState>({ ...EMPTY_DOWNLOADS, entries })
  const state = memoryStore(player)
  const shelf = new Map(Object.entries(videos))
  const videoAt = (path: string): Video => {
    const video = shelf.get(path)
    if (video === undefined) throw missing()
    return video
  }
  /** What every grant and every read of a file waits on, so a test can hold one. */
  const granting: { hold: Promise<void> } = { hold: Promise.resolve() }
  const reading: { hold: Promise<void> } = { hold: Promise.resolve() }
  const grants = createGrants({
    fs: {
      realpath: async (path) => {
        await granting.hold
        videoAt(path)
        return path
      },
      stat: async (path) => ({ isFile: () => true, ...videoAt(path) }),
    },
    newId: fileIds(),
  })
  const clock = { now: NOW }
  const warnings: string[] = []
  const names = new Map([[SERVER_ID, 'Vhagar']])
  const statted: string[] = []
  const told = { lists: 0 }
  const noted: string[] = []
  const left = { count: 0 }
  const playback = createDownloadPlayback({
    store,
    userData: USER_DATA,
    grants,
    state,
    stat: async (path) => {
      statted.push(path)
      await reading.hold
      return videoAt(path)
    },
    now: () => clock.now,
    warn: (message) => warnings.push(message),
    serverNameOf: (serverId) => names.get(serverId) ?? '',
    change: (apply) => store.update(apply),
    announce: () => {
      told.lists += 1
    },
    onNoted: ({ downloadId }) => noted.push(downloadId),
    onLeft: () => {
      left.count += 1
    },
    accountIdOf: () => signedIn.accountId,
    lastAccountIdOf: () => signedIn.lastAccountId,
  })
  return {
    playback,
    signedIn,
    store,
    state,
    grants,
    granting,
    reading,
    shelf,
    clock,
    warnings,
    names,
    statted,
    told,
    noted,
    left,
  }
}

export type World = ReturnType<typeof setup>
