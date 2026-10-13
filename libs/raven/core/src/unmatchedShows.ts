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

/** The first segment of a file's folder when it names a show, so a Fix match covers every season under it. */
export const showFolderOf = (file: { folder: string }): string | null => {
  const first = file.folder.split(/[\\/]/).find((segment) => segment !== '') ?? ''
  return first !== '' && seasonFolderNumber(first) == null ? first : null
}

/** The show folder a file sits in, else the file's own place, as the server keeps a show's files together. */
const keyOf = (file: Pick<MediaItem, 'folder' | 'fileName'>): string =>
  showFolderOf(file) ?? (file.folder === '' ? file.fileName : `${file.folder}/${file.fileName}`)

/** The show as the first file's name reads it; a name that is only an episode code reads no show, so the file's own title stands in. */
const titleOf = (file: MediaItem): string => {
  const show = parseEpisodeName({ fileName: file.fileName, folder: file.folder }).show
  return show === '' ? file.title || file.fileName : show
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
    return groups.concat({ key, title: titleOf(file), files: [file] })
  }, [])
