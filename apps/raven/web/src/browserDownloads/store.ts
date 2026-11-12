import type { DownloadDisk } from '@/browserDownloads/disk'
import { type BrowserEntry, INDEX_PATH, readIndex, writeIndex } from '@/browserDownloads/entries'
import { type DownloadTabs, INDEX_CHANGED } from '@/browserDownloads/tabs'

/** A change to the index, made of whatever the index holds when its turn comes. */
type Change = (entries: readonly BrowserEntry[]) => readonly BrowserEntry[]

type PatchProps = { downloadId: string; patch: Partial<BrowserEntry> }

export type DownloadStore = {
  /** Reads the index from disk again, keeping the changes still on their way to it. Never rejects. */
  refresh: () => Promise<void>
  /** Every account's downloads. */
  all: () => readonly BrowserEntry[]
  /** The downloads of the account the page shows. */
  own: () => BrowserEntry[]
  entryOf: (downloadId: string) => BrowserEntry | null
  account: () => string | null
  setAccount: (accountId: string | null) => void
  /** Makes a change at once in memory, and on disk in its turn. */
  change: (change: Change) => void
  patch: (input: PatchProps) => void
}

/** A read or a write of the index, run in its turn. */
type IndexTask = () => Promise<void>

type DownloadStoreDeps = { disk: DownloadDisk; tabs: DownloadTabs }

type MadeProps = { entries: readonly BrowserEntry[]; changes: readonly Change[] }

const made = ({ entries, changes }: MadeProps): readonly BrowserEntry[] =>
  changes.reduce((held, change) => change(held), entries)

/**
 * The index of downloads, in memory and on disk. Another tab may have written the file since it
 * was read, so nothing in memory is ever written over it: each change is made again of the file
 * as it is then, while no other tab holds the index, and the others are told. What a change
 * could not write stays with the next.
 */
export const createDownloadStore = ({ disk, tabs }: DownloadStoreDeps): DownloadStore => {
  const state: {
    entries: readonly BrowserEntry[]
    /** The changes memory shows that the disk does not hold yet. */
    waiting: readonly Change[]
    account: string | null
    turn: Promise<void>
  } = { entries: [], waiting: [], account: null, turn: Promise.resolve() }

  const onDisk = async (): Promise<BrowserEntry[]> => {
    const index = await disk.read(INDEX_PATH)
    return index === null ? [] : readIndex(await index.text())
  }

  /** One read or write after another, so the index in memory is never an older one landing last. */
  const inTurn = (task: IndexTask): Promise<void> => {
    state.turn = state.turn.then(task).catch(() => undefined)
    return state.turn
  }

  const write = async (): Promise<void> => {
    const changes = state.waiting
    if (changes.length === 0) return
    await tabs.withIndex(async () => {
      const written = made({ entries: await onDisk(), changes })
      await disk.write({ path: INDEX_PATH, data: writeIndex(written) })
      state.waiting = state.waiting.filter((change) => !changes.includes(change))
      state.entries = made({ entries: written, changes: state.waiting })
    })
    tabs.announce(INDEX_CHANGED)
  }

  const own = (): BrowserEntry[] =>
    state.entries.filter((entry) => entry.accountId === state.account)

  const change: DownloadStore['change'] = (next) => {
    state.waiting = [...state.waiting, next]
    state.entries = next(state.entries)
    inTurn(write).catch(() => undefined)
  }

  return {
    refresh: () =>
      inTurn(async () => {
        state.entries = made({ entries: await onDisk(), changes: state.waiting })
      }),
    all: () => state.entries,
    own,
    entryOf: (downloadId) => own().find((entry) => entry.downloadId === downloadId) ?? null,
    account: () => state.account,
    setAccount: (accountId) => {
      state.account = accountId
    },
    change,
    patch: ({ downloadId, patch }) =>
      change((entries) =>
        entries.map((entry) => (entry.downloadId === downloadId ? { ...entry, ...patch } : entry)),
      ),
  }
}
