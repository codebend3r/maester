import { Directory, File, type NetworkTaskSessionType, Paths } from 'expo-file-system'

import { DOWNLOADS_FOLDER, inFolder } from '@/downloads/downloadEntries'
import type { DownloadDisk } from '@/downloads/downloadRun'

/** What a file is called while its bytes come in. */
const PART_SUFFIX = '.part'

/**
 * A byte count from `expo-file-system` as a plain number. Its iOS module declares sizes and disk
 * space as `Int64` or `UInt64`, which Hermes hands over as a BigInt whatever its types say, and
 * arithmetic mixing one with a number throws ("Cannot convert 100 to BigInt").
 */
const byteCountOf = (value: unknown): number | null => {
  if (typeof value === 'bigint') return Number(value)
  if (typeof value === 'number' && Number.isFinite(value)) return value
  return null
}

/**
 * The app's own URL session, not iOS's background daemon: on an iPad Pro the background session
 * fetched a film at about 10 KB/s while the app was open, the server's send queue to it full.
 * A foreground task stops when the app is put away for long, and then fails with Retry.
 */
const DOWNLOAD_SESSION = 'foreground' satisfies NetworkTaskSessionType

const fileOf = (path: string): File => new File(Paths.document, path)

const folderAt = (path: string): Directory => new Directory(Paths.document, path)

/** Deletes a file or folder that may not be there. */
const deleteIfThere = (entry: File | Directory): void => {
  if (entry.exists) entry.delete()
}

/** The folders directly inside `folder`, by their paths under the documents. */
const subfoldersOf = (folder: string): string[] => {
  const directory = folderAt(folder)
  if (!directory.exists) return []
  return directory
    .list()
    .flatMap((child) =>
      child instanceof Directory ? [inFolder({ folder, file: child.name })] : [],
    )
}

/**
 * The downloads' disk, through `expo-file-system`'s `File`, `Directory` and download task (in the
 * app's own session, `DOWNLOAD_SESSION`). A file comes in
 * as a `.part` beside its place and is moved there only once it is whole, so a cut download
 * never passes for a finished one; on failure or a cancel the part is deleted.
 */
export const deviceDisk: DownloadDisk = {
  fetch: async ({ source, path, signal, onProgress }) => {
    const file = fileOf(path)
    const part = fileOf(`${path}${PART_SUFFIX}`)
    file.parentDirectory.create({ intermediates: true, idempotent: true })
    try {
      deleteIfThere(part)
      const task = File.createDownloadTask(source.uri, part, {
        headers: source.headers,
        sessionType: DOWNLOAD_SESSION,
        signal,
        onProgress: ({ bytesWritten, totalBytes }) =>
          onProgress({
            bytes: byteCountOf(bytesWritten) ?? 0,
            total: byteCountOf(totalBytes) ?? -1,
          }),
      })
      const written = await task.downloadAsync()
      if (written === null) throw new Error('The download was paused.')
      deleteIfThere(file)
      part.moveSync(file)
      return byteCountOf(fileOf(path).size) ?? 0
    } catch (error) {
      deleteIfThere(part)
      throw error
    }
  },
  uriOf: (path) => fileOf(path).uri,
  exists: (path) => fileOf(path).exists,
  folders: () => subfoldersOf(DOWNLOADS_FOLDER).flatMap(subfoldersOf),
  remove: async (folder) => deleteIfThere(folderAt(folder)),
  removeAll: async () => deleteIfThere(folderAt(DOWNLOADS_FOLDER)),
  freeBytes: () => {
    try {
      return byteCountOf(Paths.availableDiskSpace)
    } catch {
      return null
    }
  },
}
