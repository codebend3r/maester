import { readdir, rm } from 'node:fs/promises'
import { join } from 'node:path'

type RemoveFilesProps = {
  dir: string
  /** Whether the file of this name is to go. */
  isGone: (name: string) => boolean
}

/** Deletes the files in `dir` that `isGone` picks; a folder that is not there holds none. */
export const removeFiles = async ({ dir, isGone }: RemoveFilesProps): Promise<void> => {
  const names = await readdir(dir).catch((): string[] => [])
  await Promise.all(names.filter(isGone).map((name) => rm(join(dir, name), { force: true })))
}
