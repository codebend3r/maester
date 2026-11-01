import { Directory, File, Paths } from 'expo-file-system'

import { DOWNLOADS_FOLDER, type DownloadDisk } from '@/downloads/downloadStore'

/** What a file is called while its bytes come in. */
const PART_SUFFIX = '.part'

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
    .flatMap((child) => (child instanceof Directory ? [`${folder}/${child.name}`] : []))
}

/**
 * The downloads' disk, through `expo-file-system`'s `File` and `Directory` (its current API, not
 * `expo-file-system/legacy`'s `createDownloadResumable`). A file downloads into a `.part`
 * beside its place and is moved there only once it is whole, so a cut download never passes for
 * a finished one; on failure the part is deleted.
 */
export const deviceDisk: DownloadDisk = {
  fetch: async ({ source, path }) => {
    const file = fileOf(path)
    const part = fileOf(`${path}${PART_SUFFIX}`)
    file.parentDirectory.create({ intermediates: true, idempotent: true })
    try {
      await File.downloadFileAsync(source.uri, part, { headers: source.headers, idempotent: true })
      deleteIfThere(file)
      part.moveSync(file)
      return fileOf(path).size
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
}
