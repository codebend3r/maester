import {
  EMPTY_DOWNLOADS,
  NO_PENDING,
  notePending,
  type DownloadEntry,
  type DownloadsState,
  type Owed,
} from '@/main/downloads/downloadState'
import { createSync, SYNC_RETRY_MS } from '@/main/downloads/sync'
import type { AllowedCall } from '@/main/servers/allowlist'
import type { ServerCallResult } from '@/main/servers/serverCalls'
import type { JsonStore } from '@/main/stateStore'
import { fakeTimers } from '@/main/test/playerFakes'

export const SERVER_ID = '6f1c1c0e-3b0a-4f4e-8a55-0d2f3c5b7e11'
export const ID = '0f8fad5b-d9cb-469f-a165-70867728950e'
export const NOW = 1_700_000_000_000
const GIB = 1024 ** 3
export const NO_CONTENT: ServerCallResult = { ok: true, status: 204, body: '' }

export const entryFor = (overrides: Partial<DownloadEntry> = {}): DownloadEntry => ({
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
  ...overrides,
})

const memoryStore = (initial: DownloadsState): JsonStore<DownloadsState> => {
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

/** A promise settled from outside, so a test can hold a call and answer it later. */
export const gate = () => {
  const held: { open: (result: ServerCallResult) => void } = { open: () => undefined }
  const answer = new Promise<ServerCallResult>((resolve) => {
    held.open = resolve
  })
  return { answer, open: held.open }
}

/** A sync over one store in memory, its calls answered by `server.answer` and recorded in `log`. */
export const setupSync = ({
  entries = [entryFor()],
  owed = [],
  retryMs = SYNC_RETRY_MS,
  accountId = null,
}: {
  entries?: DownloadEntry[]
  owed?: Owed[]
  retryMs?: number
  /** The account signed in to the server, as its stored session names it. */
  accountId?: string | null
} = {}) => {
  const signedIn = { accountId }
  const store = memoryStore({ ...EMPTY_DOWNLOADS, entries, owed })
  const { timers, pending } = fakeTimers()
  const log: AllowedCall[] = []
  const server: { answer: (call: AllowedCall) => Promise<ServerCallResult> } = {
    answer: async () => NO_CONTENT,
  }
  const warnings: string[] = []
  /** The account each call was made for; null for one made for whoever is signed in. */
  const asked: (string | null)[] = []
  const sync = createSync({
    store,
    calls: {
      call: async ({ call, accountId: askedAs = null }) => {
        log.push(call)
        asked.push(askedAs)
        return server.answer(call)
      },
    },
    timers,
    warn: (message) => warnings.push(message),
    retryMs,
    accountIdOf: () => signedIn.accountId,
  })
  /** Records a play and a position for a download, as playback does, then touches it. */
  const note = ({
    downloadId = ID,
    play = false,
    position,
  }: {
    downloadId?: string
    play?: boolean
    position: number
  }): void => {
    store.update((state) =>
      notePending(state, { downloadId, play, position, at: NOW, accountId: signedIn.accountId }),
    )
    sync.touch({ downloadId })
  }
  /** Runs the timers set for this long, as the clock would. */
  const fireAt = (ms: number): void => {
    const due = [...pending].filter(([, timer]) => timer.ms === ms)
    due.forEach(([handle, timer]) => {
      pending.delete(handle)
      timer.run()
    })
  }
  const pendingOf = (downloadId = ID) =>
    store.read().entries.find((entry) => entry.downloadId === downloadId)?.pending ?? null
  return { sync, store, pending, log, server, warnings, note, fireAt, pendingOf, signedIn, asked }
}
