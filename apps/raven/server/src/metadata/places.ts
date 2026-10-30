import { dirname, join } from 'node:path'
import {
  foldTitle,
  isExtra,
  ITEM_TYPES,
  type MatchItemType,
  parseMovieName,
  showFolderOf,
} from '@raven/core'

/** Where a file sits: its path, and its name and folder inside its library. */
export type Placed = { path: string; folder: string; fileName: string }

/** A file's name without its extension. */
export const stemOf = (fileName: string): string => {
  const dot = fileName.lastIndexOf('.')
  return dot > 0 ? fileName.slice(0, dot) : fileName
}

type FilePlaceProps = { folder: string; fileName: string }

/** A file's own place: its path inside the folder its titles sit in, the key a Fix match is kept under when its folder holds more. */
export const filePlace = (file: FilePlaceProps): string =>
  file.folder === '' ? file.fileName : join(file.folder, file.fileName)

/** The folder a file's titles sit in (a library path, or a letter or group folder), which its path starts with. */
export const rootOf = (file: Placed): string =>
  file.path.slice(0, file.path.length - filePlace(file).length - 1)

type ShowPlaceProps = { folder: string; fileName: string }

/** Where a show's files are kept together: the show's folder, or the file itself at a root. */
export const showPlace = (file: ShowPlaceProps): string => showFolderOf(file) ?? filePlace(file)

/** The folder a show's pictures and NFO sit in: its show folder, or the file's own at a root. */
export const showDirOf = (file: Placed): string => {
  const showFolder = showFolderOf(file)
  return showFolder == null ? dirname(file.path) : join(rootOf(file), showFolder)
}

type HoldsOneMovieProps = {
  folder: string
  files: ReadonlyArray<{ fileName: string; folder: string }>
}

/**
 * Whether a folder's files are one movie, perhaps in several qualities: its
 * own pictures, NFO and Fix match then belong to that movie. Extras do not
 * count, and the folder titles sit in (a library path, a letter or group folder) never holds one movie.
 */
export const holdsOneMovie = ({ folder, files }: HoldsOneMovieProps): boolean => {
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

type GroupPlaceOfProps = {
  type: MatchItemType
  file: { folder: string; fileName: string }
  /** The files in the movie's folder, read only for a movie in a folder. */
  folderFiles: () => ReadonlyArray<{ fileName: string; folder: string }>
}

/**
 * The place a group keeps its Fix match and AI decision under, as
 * `fixGroup` reads it: a show's folder (or the file, at a root), a movie's
 * folder when it holds that one movie, else the movie file's own place.
 */
export const groupPlaceOf = ({ type, file, folderFiles }: GroupPlaceOfProps): string => {
  if (type === ITEM_TYPES.show) return showPlace(file)
  const files = file.folder === '' ? [] : folderFiles()
  return holdsOneMovie({ folder: file.folder, files }) ? file.folder : filePlace(file)
}
