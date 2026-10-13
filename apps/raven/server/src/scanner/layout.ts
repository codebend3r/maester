import { dirname, join, relative } from 'node:path'
import {
  type FolderLayout,
  type LibraryKind,
  type PathLayout,
  describeLayout,
  groupFolderOf,
  matchTypeFor,
} from '@raven/core'
import { groupBy } from '@/groupBy'
import { filePlace, showPlace } from '@/metadata/places'
import { type FoundFile, isUnder } from '@/scanner/walk'

/**
 * The folder a file's titles sit in: its library path, or the letter or
 * group folder under it that holds the titles. `media.folder` is measured
 * from here, so grouping, pictures and Fix match see `Andor/Season 1`, never
 * `A/Andor/Season 1`.
 */
export const titleRootOf = ({
  root,
  path,
  kind,
  layout,
}: {
  root: string
  path: string
  kind: LibraryKind
  layout: FolderLayout
}): string => {
  const group = groupFolderOf({ kind, folder: relative(root, dirname(path)), layout })
  return group == null ? root : join(root, group)
}

/** The walk's files, each rooted at the folder its titles sit in. */
export const withTitleRoots = ({
  files,
  kind,
  layout,
}: {
  files: readonly FoundFile[]
  kind: LibraryKind
  layout: FolderLayout
}): FoundFile[] =>
  files.map((file) => ({
    ...file,
    root: titleRootOf({ root: file.root, path: file.path, kind, layout }),
  }))

/** What each library path is, from the walk's files rooted at their library paths. */
export const layoutsOf = ({
  roots,
  files,
  kind,
  layout,
}: {
  roots: readonly string[]
  files: readonly FoundFile[]
  kind: LibraryKind
  layout: FolderLayout
}): Array<{ path: string; layout: PathLayout; groups: number }> =>
  roots.map((root) => {
    const groups = files
      .filter((file) => file.root === root)
      .flatMap(
        (file) => groupFolderOf({ kind, folder: relative(root, dirname(file.path)), layout }) ?? [],
      )
    return { path: root, layout: describeLayout(groups), groups: new Set(groups).size }
  })

/** A file as the index has it, for reading its place again. */
export type LayoutRow = { id: number; path: string; folder: string; fileName: string }

/** What a relayout changes: files' folders, and the Fix match places that move or go. */
export type RelayoutPlan = {
  moves: Array<{ id: number; folder: string }>
  overrides: Array<{ from: string; to: string | null }>
}

/** The places a Fix match can be kept under for a file: a show's folder or a movie's, and its own. */
const fixPlacesOf = ({
  kind,
  file,
}: {
  kind: LibraryKind
  file: { folder: string; fileName: string }
}): string[] =>
  matchTypeFor(kind) === 'show'
    ? [showPlace(file), filePlace(file)]
    : [file.folder, filePlace(file)]

/**
 * Reads every file's place again for the library's type and folder layout.
 * Only files whose folder changes move. A Fix match moves with its files
 * when its old place now names one place; one that named several, such as a
 * whole letter folder kept as one show, is dropped, as it was made for files
 * that were never one title.
 */
export const planRelayout = ({
  rows,
  roots,
  kind,
  layout,
  overrides,
}: {
  rows: readonly LayoutRow[]
  roots: readonly string[]
  kind: LibraryKind
  layout: FolderLayout
  overrides: readonly string[]
}): RelayoutPlan => {
  const moved = rows.flatMap((file) => {
    const root = roots.find((candidate) => isUnder({ path: file.path, root: candidate }))
    if (root == null) return []
    const folder = relative(
      titleRootOf({ root, path: file.path, kind, layout }),
      dirname(file.path),
    )
    return folder === file.folder ? [] : [{ file, folder }]
  })
  const pairs = moved.flatMap(({ file, folder }) => {
    const after = fixPlacesOf({ kind, file: { folder, fileName: file.fileName } })
    return fixPlacesOf({ kind, file })
      .map((from, index) => ({ from, to: after[index] ?? '' }))
      .filter((pair) => pair.from !== '')
  })
  const targets = groupBy({ items: pairs, key: (pair) => pair.from })
  return {
    moves: moved.map(({ file, folder }) => ({ id: file.id, folder })),
    overrides: overrides.flatMap((from) => {
      const to = [...new Set((targets.get(from) ?? []).map((pair) => pair.to))]
      if (to.length === 0) return []
      const [only] = to
      return [{ from, to: to.length === 1 && only != null && only !== '' ? only : null }]
    }),
  }
}
