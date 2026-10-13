import type { MediaItem } from '@/contract'
import { parseEpisodeName, seasonFolderNumber } from '@/naming'

/** A show folder's files no show was found for, as one entry. */
export type UnmatchedShow = {
  /** The show folder, or the file's own place when it sits at a root: unique within a listing. */
  key: string
  /** The show as the first file's name reads it: `parseEpisodeName({ fileName, folder }).show`. */
  title: string
  /** Its files, in the order they came. */
  files: MediaItem[]
}

/** The show folder a file sits in, else the file's own place, as the server keeps a show's files together. */
const keyOf = ({ folder, fileName }: Pick<MediaItem, 'folder' | 'fileName'>): string => {
  const first = folder.split(/[\\/]/).find((segment) => segment !== '') ?? ''
  if (first !== '' && seasonFolderNumber(first) == null) return first
  return folder === '' ? fileName : `${folder}/${fileName}`
}

/** A TV library's unmatched files gathered by show folder, groups in the order their first file came. */
export const unmatchedShowsOf = (files: readonly MediaItem[]): UnmatchedShow[] =>
  files.reduce<UnmatchedShow[]>((groups, file) => {
    const key = keyOf(file)
    if (groups.some((group) => group.key === key)) {
      return groups.map((group) =>
        group.key === key ? { ...group, files: group.files.concat(file) } : group,
      )
    }
    const title = parseEpisodeName({ fileName: file.fileName, folder: file.folder }).show
    return groups.concat({ key, title, files: [file] })
  }, [])
