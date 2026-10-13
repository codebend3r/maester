import { dirname, join } from 'node:path'
import { foldTitle, isExtra, parseMovieName, showFolderOf } from '@raven/core'

/** Where a file sits: its path, and its name and folder inside its library. */
export type Placed = { path: string; folder: string; fileName: string }

/** A file's name without its extension. */
export const stemOf = (fileName: string): string => {
  const dot = fileName.lastIndexOf('.')
  return dot > 0 ? fileName.slice(0, dot) : fileName
}

/** A file's own place: its path inside the library, the key a Fix match is kept under when its folder holds more. */
export const filePlace = (file: { folder: string; fileName: string }): string =>
  file.folder === '' ? file.fileName : join(file.folder, file.fileName)

/** The library path a file was found under, which its path starts with. */
export const rootOf = (file: Placed): string =>
  file.path.slice(0, file.path.length - filePlace(file).length - 1)

/** Where a show's files are kept together: the show's folder, or the file itself at a root. */
export const showPlace = (file: { folder: string; fileName: string }): string =>
  showFolderOf(file) ?? filePlace(file)

/** The folder a show's pictures and NFO sit in: its show folder, or the file's own at a root. */
export const showDirOf = (file: Placed): string => {
  const showFolder = showFolderOf(file)
  return showFolder == null ? dirname(file.path) : join(rootOf(file), showFolder)
}

/**
 * Whether a folder's files are one movie, perhaps in several qualities: its
 * own pictures, NFO and Fix match then belong to that movie. Extras do not
 * count, and a library's root never holds one movie.
 */
export const holdsOneMovie = ({
  folder,
  files,
}: {
  folder: string
  files: ReadonlyArray<{ fileName: string; folder: string }>
}): boolean => {
  if (folder === '') return false
  const movies = new Set(
    files
      .filter((file) => !isExtra(file))
      .map((file) => {
        const parsed = parseMovieName(file)
        return `${foldTitle(parsed.title)}|${parsed.year ?? ''}`
      }),
  )
  return movies.size === 1
}
