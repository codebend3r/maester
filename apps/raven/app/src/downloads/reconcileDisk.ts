import { type DownloadDisk, reconcileDownloads } from '@raven/native/headless'

import { DOWNLOAD_COPY } from '@/downloads/copy'
import { type DownloadEntry, failedWith, folderOfEntry, isDone } from '@/downloads/downloadEntries'

type ReconcileDiskProps = {
  entries: Readonly<Record<string, DownloadEntry>>
  disk: DownloadDisk
}

/**
 * Brings what was read back and what is on disk into line, as `@raven/native`'s
 * `reconcileDownloads` does: a finished download whose file has gone fails, to be fetched
 * again, and every folder no finished download holds is deleted.
 */
export const reconcileDisk = ({ entries, disk }: ReconcileDiskProps) =>
  reconcileDownloads({
    entries,
    disk,
    isDone,
    pathOf: (entry) => entry.path,
    foldersOf: (entry) => [folderOfEntry(entry)],
    failed: (entry): DownloadEntry => ({ ...entry, status: failedWith(DOWNLOAD_COPY.failed) }),
  })
