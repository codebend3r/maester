import { DOWNLOAD_COPY } from '@/downloads/copy'
import { type DownloadEntry, failedWith, folderOfEntry, isDone } from '@/downloads/downloadEntries'
import type { DownloadDisk } from '@/downloads/downloadRun'

type ReconcileDiskProps = {
  entries: Readonly<Record<string, DownloadEntry>>
  disk: DownloadDisk
}

/**
 * Brings what was read back and what is on disk into line: a finished download whose file has
 * gone (the system cleared space, or the app was restored) fails, to be fetched again, and
 * every folder no finished download holds, a stopped one's `.part` among them, is deleted.
 * Resolves the entries as they stand after.
 */
export const reconcileDisk = async ({
  entries,
  disk,
}: ReconcileDiskProps): Promise<Record<string, DownloadEntry>> => {
  const checked = Object.fromEntries(
    Object.entries(entries).map(([key, entry]): [string, DownloadEntry] => [
      key,
      isDone(entry) && !disk.exists(entry.path)
        ? { ...entry, status: failedWith(DOWNLOAD_COPY.failed) }
        : entry,
    ]),
  )
  const held = new Set(Object.values(checked).filter(isDone).map(folderOfEntry))
  const strays = disk.folders().filter((folder) => !held.has(folder))
  await Promise.allSettled(strays.map((folder) => disk.remove(folder)))
  return checked
}
