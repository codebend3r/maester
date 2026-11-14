/** How far a download has come: its bytes, and its whole size, or -1 while unknown. */
export type DownloadReading = { bytes: number; total: number }

/** What a download fetches: the address and the headers it sends. */
export type DiskSource = { uri: string; headers: Record<string, string> }

export type DiskFetchProps = {
  source: DiskSource
  path: string
  /** Aborted when the download is cancelled; null for one that is never cancelled mid-file. */
  signal: AbortSignal | null
  /** Hears the bytes as they come in; null when nothing shows them. */
  onProgress: ((reading: DownloadReading) => void) | null
}

/** Where the bytes go: `expo-file-system` on the device, memory in the tests. */
export type DownloadDisk = {
  /** Fetches `source` into a `.part` beside `path`, then moves it there; resolves its bytes. Leaves no file when it fails. */
  fetch: (props: DiskFetchProps) => Promise<number>
  /** The `file://` address `path` is at now. */
  uriOf: (path: string) => string
  /** Whether a file is at `path`. */
  exists: (path: string) => boolean
  /** Every download's folder on disk, `downloads/<serverId>/<mediaId>`. */
  folders: () => string[]
  /** Deletes a download's folder and all in it. */
  remove: (folder: string) => Promise<void>
  /** Deletes every download. */
  removeAll: () => Promise<void>
  /** The bytes free on the device; null where it cannot say. */
  freeBytes: () => number | null
}

/** Holds the place of the device's disk until a store is configured: every fetch fails, and nothing is on disk. */
export const UNCONFIGURED_DISK: DownloadDisk = {
  fetch: async () => {
    throw new Error('Downloads are not configured.')
  },
  uriOf: (path) => path,
  exists: () => false,
  folders: () => [],
  remove: async () => undefined,
  removeAll: async () => undefined,
  freeBytes: () => null,
}

type ReconcileDownloadsProps<E> = {
  entries: Readonly<Record<string, E>>
  disk: Pick<DownloadDisk, 'exists' | 'folders' | 'remove'>
  isDone: (entry: E) => boolean
  pathOf: (entry: E) => string
  /** The folders a finished entry's files are in: its own, and any it shares, as an album's cover. */
  foldersOf: (entry: E) => readonly string[]
  /** The entry failed, to be fetched again, once its file has gone. */
  failed: (entry: E) => E
}

/**
 * Brings what was read back and what is on disk into line: a finished download whose file has
 * gone (the system cleared space, or the app was restored) fails, to be fetched again, and
 * every folder no finished download holds, a stopped one's `.part` among them, is deleted.
 * Resolves the entries as they stand after.
 */
export const reconcileDownloads = async <E>({
  entries,
  disk,
  isDone,
  pathOf,
  foldersOf,
  failed,
}: ReconcileDownloadsProps<E>): Promise<Record<string, E>> => {
  const checked = Object.fromEntries(
    Object.entries(entries).map(([key, entry]): [string, E] => [
      key,
      isDone(entry) && !disk.exists(pathOf(entry)) ? failed(entry) : entry,
    ]),
  )
  const held = new Set(Object.values(checked).filter(isDone).flatMap(foldersOf))
  const strays = disk.folders().filter((folder) => !held.has(folder))
  await Promise.allSettled(strays.map((folder) => disk.remove(folder)))
  return checked
}

type KeepReconciledProps<E> = {
  /** The entries as they were read before reconciling. */
  read: Readonly<Record<string, E>>
  /** What reconciling made of them. */
  checked: Readonly<Record<string, E>>
  /** The entries now, which a download may have changed while the disk was squared. */
  now: Readonly<Record<string, E>>
}

/**
 * The entries now with reconciling's answers laid over only those nothing touched meanwhile, so a
 * download queued, finished or removed while the disk was squared is never undone.
 */
export const keepReconciled = <E>({
  read,
  checked,
  now,
}: KeepReconciledProps<E>): Record<string, E> =>
  Object.fromEntries(
    Object.entries(now).map(([key, entry]): [string, E] => [
      key,
      entry === read[key] ? (checked[key] ?? entry) : entry,
    ]),
  )
