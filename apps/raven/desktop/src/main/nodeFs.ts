import { mkdir, open, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import type { PartFile } from '@/main/downloads/fetchFile'
import { isMissingFile, type StateFs } from '@/main/stateStore'

/** Node's file system as main's services take it: each call shaped for the seam it fills. */

/** Makes the folder and every missing parent; nothing when it is there already. */
export const makeDir = (path: string): Promise<void> =>
  mkdir(path, { recursive: true }).then(() => undefined)

/** Removes a file or a whole folder; nothing when there is no such path. */
export const removeTree = (path: string): Promise<void> =>
  rm(path, { recursive: true, force: true })

/** A file's size in bytes, 0 when there is no such file. */
export const sizeOf = (path: string): Promise<number> =>
  stat(path).then(
    ({ size }) => size,
    (error: unknown) => {
      if (isMissingFile(error)) return 0
      throw error
    },
  )

export const exists = (path: string): Promise<boolean> =>
  stat(path).then(
    () => true,
    () => false,
  )

/** The JSON stores' files, read and written as UTF-8 text and swapped in by rename. */
export const TEXT_FS: StateFs = {
  readFile: (path) => readFile(path, 'utf8'),
  writeFile: ({ path, data }) => writeFile(path, data, 'utf8'),
  rename: ({ from, to }) => rename(from, to),
}

/** A download's `.part`, opened to append; its size is read from disk each time. */
export const openPart = async (path: string): Promise<PartFile> => {
  const handle = await open(path, 'a+')
  return {
    size: async () => (await handle.stat()).size,
    append: (chunk) => handle.appendFile(chunk),
    truncate: () => handle.truncate(0),
    // On disk before the bytes it holds are counted, so a crash leaves a part the resume can trust.
    close: () => handle.datasync().finally(() => handle.close()),
  }
}
