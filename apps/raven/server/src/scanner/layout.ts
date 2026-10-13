import { dirname, join, relative } from 'node:path'
import {
  type FolderLayout,
  type LibraryKind,
  type PathLayout,
  describeLayout,
  groupFolderOf,
} from '@raven/core'
import type { FoundFile } from '@/scanner/walk'

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
