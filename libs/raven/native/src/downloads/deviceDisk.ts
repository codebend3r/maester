import { HTTP_METHODS } from '@raven/core'
import { Directory, File, type NetworkTaskSessionType, Paths } from 'expo-file-system'

import { byteCountOf } from '@/downloads/byteCount'
import type { DiskFetchProps, DownloadDisk } from '@/downloads/downloadDisk'
import { DOWNLOADS_FOLDER, PART_SUFFIX, inFolder } from '@/downloads/downloadPaths'
import { FETCH_CREDENTIALS } from '@/servers/serverFetch'

/**
 * The app's own URL session, not iOS's background daemon: on an iPad Pro the background session
 * fetched a film at about 10 KB/s while the app was open, the server's send queue to it full.
 * A foreground task stops when the app is put away for long, and then fails with Retry.
 */
const DOWNLOAD_SESSION = 'foreground' satisfies NetworkTaskSessionType

const PREPARE_REQUEST = { method: HTTP_METHODS.head, credentials: FETCH_CREDENTIALS.omit } as const

type TransferProps = Omit<DiskFetchProps, 'path'> & { part: File }

/** How a file's bytes come into its `.part`. */
type Transfer = (props: TransferProps) => Promise<void>

/**
 * A download task in the app's own session (`DOWNLOAD_SESSION`), cancelled by the signal and
 * read as it comes in: the device app's videos and tracks.
 */
const taskTransfer: Transfer = async ({ source, part, signal, onProgress }) => {
  const task = File.createDownloadTask(source.uri, part, {
    headers: source.headers,
    sessionType: DOWNLOAD_SESSION,
    ...(signal === null ? {} : { signal }),
    ...(onProgress === null
      ? {}
      : {
          onProgress: ({ bytesWritten, totalBytes }) =>
            onProgress({
              bytes: byteCountOf(bytesWritten) ?? 0,
              total: byteCountOf(totalBytes) ?? -1,
            }),
        }),
  })
  const written = await task.downloadAsync()
  if (written === null) throw new Error('The download was paused.')
}

/**
 * A body-free HEAD through React Native's fetch first, which waits for the server to prepare a
 * cold transcode, then the file: iOS's file downloader times out after 60 s. Wren's tracks.
 */
const preparedTransfer: Transfer = async ({ source, part }) => {
  const prepared = await fetch(source.uri, { ...PREPARE_REQUEST, headers: source.headers })
  if (!prepared.ok) throw new Error(`Could not prepare download (${prepared.status})`)
  await File.downloadFileAsync(source.uri, part, { headers: source.headers, idempotent: true })
}

/** The ways a disk fetches a file: a cancellable task, or a prepared transcode. */
export const DISK_TRANSFERS = { task: taskTransfer, prepared: preparedTransfer } as const

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

type DeviceDiskForProps = { transfer: Transfer }

/**
 * The downloads' disk, through `expo-file-system`'s `File` and `Directory` (its current API, not
 * `expo-file-system/legacy`). A file comes in as a `.part` beside its place and is moved there
 * only once it is whole, so a cut download never passes for a finished one; on failure or a
 * cancel the part is deleted. Every size is read through `byteCountOf`, since iOS hands one over
 * as a BigInt.
 */
export const deviceDiskFor = ({ transfer }: DeviceDiskForProps): DownloadDisk => ({
  fetch: async ({ source, path, signal, onProgress }) => {
    const file = fileOf(path)
    const part = fileOf(`${path}${PART_SUFFIX}`)
    file.parentDirectory.create({ intermediates: true, idempotent: true })
    try {
      deleteIfThere(part)
      await transfer({ source, part, signal, onProgress })
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
})
