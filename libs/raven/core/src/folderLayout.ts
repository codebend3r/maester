import {
  FOLDER_LAYOUTS,
  type FolderLayout,
  ITEM_TYPES,
  type LibraryKind,
  PATH_LAYOUTS,
  type PathLayout,
} from '@/contract'
import { matchTypeFor } from '@/libraryKinds'
import { seasonFolderNumber, yearOf } from '@/naming'

/** A letter folder: one letter, `#`, `0-9`, or a run of letters such as `A-C`. */
export const isLetterFolder = (name: string): boolean =>
  /^(?:[a-z]|#|0-9|[a-z]\s*-\s*[a-z])$/i.test(name.trim())

const isSeasonFolder = (name: string | undefined): boolean =>
  name != null && seasonFolderNumber(name) != null

type GroupFolderOfProps = {
  kind: LibraryKind
  folder: string
  layout: FolderLayout
}

/**
 * The top folder of a file's place when it groups titles rather than being
 * one, so the titles are the folders inside it; null when the top folder is
 * the title. Read from the file's own folder alone, so a full scan and a
 * refresh of one place agree.
 *
 * - A letter folder groups titles, unless a season folder sits right under
 *   it: `K/Season 1` is the show K.
 * - In a TV library, a folder whose shows hold the season folders groups
 *   them: `Requests/Cupertino/Season 1`.
 * - In a movie library, a folder with no year that holds folders with years
 *   groups them: `Requests/25th Hour (2002)`.
 *
 * A library that is never matched, or one set to `flat`, has none.
 */
export const groupFolderOf = ({ kind, folder, layout }: GroupFolderOfProps): string | null => {
  const type = matchTypeFor(kind)
  if (layout === FOLDER_LAYOUTS.flat || type == null) return null
  const [top, second, third] = folder.split(/[\\/]/).filter((segment) => segment !== '')
  if (top == null) return null
  if (isLetterFolder(top)) return isSeasonFolder(second) ? null : top
  if (second == null) return null
  if (type === ITEM_TYPES.show) return !isSeasonFolder(second) && isSeasonFolder(third) ? top : null
  return yearOf(top) == null && yearOf(second) != null ? top : null
}

/** What a library path is, from the group folders its files were found in. */
export const describeLayout = (groupFolders: readonly string[]): PathLayout => {
  const distinct = [...new Set(groupFolders)]
  if (distinct.length === 0) return PATH_LAYOUTS.flat
  return distinct.filter(isLetterFolder).length * 2 >= distinct.length
    ? PATH_LAYOUTS.lettered
    : PATH_LAYOUTS.grouped
}
