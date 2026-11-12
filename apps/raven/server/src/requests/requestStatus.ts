import { REQUEST_STATUSES, type RequestStatus } from '@raven/core'
import type { ArrProgress, QueueEntry } from '@/requests/arrClient'

/** A queue entry's `status` while the download client is fetching it, and once it has. */
const CLIENT_STATES = { downloading: 'downloading', completed: 'completed' } as const

/** The arr's `trackedDownloadState`s once the download is whole and it is moving the file into the library. */
const IMPORT_STATES: ReadonlySet<string> = new Set(['importPending', 'importing', 'imported'])

const isImporting = (entry: QueueEntry): boolean =>
  entry.status === CLIENT_STATES.completed || IMPORT_STATES.has(entry.trackedDownloadState ?? '')

const isDownloading = (entry: QueueEntry): boolean => entry.status === CLIENT_STATES.downloading

type StatusOfProps = {
  progress: ArrProgress
  /** Whether the search the request started is still queued or running. */
  isSearching: boolean
}

/**
 * Where a request stands: a download importing or whole is `downloaded`, one
 * being fetched `downloading`, any other in the queue `willDownload`; with
 * none queued, a file the arr holds is `downloaded`, a search still running
 * `searching`, and anything else `notDownloadable`.
 */
export const statusOf = ({ progress, isSearching }: StatusOfProps): RequestStatus => {
  const { queue, hasFile } = progress
  if (queue.some(isImporting)) return REQUEST_STATUSES.downloaded
  if (queue.some(isDownloading)) return REQUEST_STATUSES.downloading
  if (queue.length > 0) return REQUEST_STATUSES.willDownload
  if (hasFile) return REQUEST_STATUSES.downloaded
  if (isSearching) return REQUEST_STATUSES.searching
  return REQUEST_STATUSES.notDownloadable
}
