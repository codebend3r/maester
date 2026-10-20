import {
  EMPTY_DOWNLOADS,
  isStoredDownloads,
  upgradeDownloads,
  type DownloadsState,
} from '@/main/downloads/downloadState'
import { JSON_READ_KINDS, readJsonFile, type JsonStore, type StateFs } from '@/main/stateStore'

export type DownloadsStore = JsonStore<DownloadsState>

export const DOWNLOADS_DEBOUNCE_MS = 1000

/** The downloads, and whether an unreadable `downloads.json` was set aside to load them empty. */
export type LoadedDownloads = { state: DownloadsState; wasSetAside: boolean }

export const loadDownloads = async ({
  fs,
  file,
  now,
}: {
  fs: StateFs
  file: string
  now: () => number
}): Promise<LoadedDownloads> => {
  const read = await readJsonFile({ fs, file, now, guard: isStoredDownloads })
  switch (read.kind) {
    case JSON_READ_KINDS.read:
      return { state: upgradeDownloads(read.value), wasSetAside: false }
    case JSON_READ_KINDS.missing:
      return { state: EMPTY_DOWNLOADS, wasSetAside: false }
    case JSON_READ_KINDS.setAside:
      return { state: EMPTY_DOWNLOADS, wasSetAside: true }
    default: {
      const unreachable: never = read
      return unreachable
    }
  }
}
