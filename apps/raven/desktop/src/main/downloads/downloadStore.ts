import {
  EMPTY_DOWNLOADS,
  isDownloadsState,
  type DownloadsState,
} from '@/main/downloads/downloadState'
import { loadJson, type JsonStore, type StateFs } from '@/main/stateStore'

export type DownloadsStore = JsonStore<DownloadsState>

export const DOWNLOADS_DEBOUNCE_MS = 1000

export const loadDownloads = ({
  fs,
  file,
  now,
}: {
  fs: StateFs
  file: string
  now: () => number
}): Promise<DownloadsState> =>
  loadJson({ fs, file, now, guard: isDownloadsState, empty: EMPTY_DOWNLOADS })
