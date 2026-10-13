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

/** What each library path is, from files rooted at their library paths: the walk's, or the index's. */
export const layoutsOf = ({
  roots,
  files,
  kind,
  layout,
}: {
  roots: readonly string[]
  files: ReadonlyArray<{ path: string; root: string }>
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

/**
 * What each library path is, from the files the index holds under it, for a
 * layout change no scan follows. A path holding none is left out, so it keeps
 * what it had, as one a scan cannot read does; files under none are skipped.
 */
export const indexedLayoutsOf = ({
  rows,
  roots,
  kind,
  layout,
}: {
  rows: ReadonlyArray<{ path: string }>
  roots: readonly string[]
  kind: LibraryKind
  layout: FolderLayout
}): Array<{ path: string; layout: PathLayout; groups: number }> => {
  const files = rows.flatMap((row) => {
    const root = roots.find((candidate) => isUnder({ path: row.path, root: candidate }))
    return root == null ? [] : [{ path: row.path, root }]
  })
  const held = new Set(files.map((file) => file.root))
  return layoutsOf({ roots: roots.filter((root) => held.has(root)), files, kind, layout })
}

/** A file as the index has it, for reading its place again. */
export type LayoutRow = { id: number; path: string; folder: string; fileName: string }

/** What a relayout changes: files' folders, and the Fix match places that move or go. */
export type RelayoutPlan = {
  moves: Array<{ id: number; folder: string }>
  overrides: Array<{ from: string; to: string | null }>
}

/** Where a Fix match can be kept for a file: its title's place, and its own. */
type FixPlaces = { title: string; own: string }

/**
 * The places a Fix match can be kept under for a file: its title's (a show's
 * folder, or a movie's) and its own. A file at a title root has no folder of
 * its own, as `fixGroup` reads it, so its own place is its title's too.
 */
const fixPlacesOf = ({
  kind,
  file,
}: {
  kind: LibraryKind
  file: { folder: string; fileName: string }
}): FixPlaces => {
  const own = filePlace(file)
  if (matchTypeFor(kind) === 'show') return { title: showPlace(file), own }
  return { title: file.folder === '' ? own : file.folder, own }
}

/**
 * Where a moving file takes the places a Fix match can be kept under. A file
 * whose title's place is its own takes it as its own alone, so the folder it
 * comes to share with other titles never claims it.
 */
const fixMovesOf = ({
  kind,
  file,
  folder,
}: {
  kind: LibraryKind
  file: LayoutRow
  folder: string
}): Array<{ id: number; from: string; to: string }> => {
  const before = fixPlacesOf({ kind, file })
  const after = fixPlacesOf({ kind, file: { folder, fileName: file.fileName } })
  return before.title === before.own
    ? [{ id: file.id, from: before.own, to: after.own }]
    : [
        { id: file.id, from: before.title, to: after.title },
        { id: file.id, from: before.own, to: after.own },
      ]
}

/** What becomes of one Fix match: it stays where it is, goes, or moves to one new place. */
type FixFate = { from: string } & (
  | { fate: 'stays' }
  | { fate: 'goes' }
  | { fate: 'moves'; to: string }
)

/** Holds every move into a place a Fix match stays at, again until none is left, as each hold leaves one more staying. */
const holdTaken = (fates: readonly FixFate[]): readonly FixFate[] => {
  const staying = new Set(
    fates.filter((fixed) => fixed.fate === 'stays').map((fixed) => fixed.from),
  )
  const held = fates.map((fixed): FixFate =>
    fixed.fate === 'moves' && staying.has(fixed.to) ? { from: fixed.from, fate: 'stays' } : fixed,
  )
  return held.some((fixed, index) => fixed !== fates[index]) ? holdTaken(held) : fates
}

/**
 * Reads every file's place again for the library's type and folder layout.
 * Only files whose folder changes move. A Fix match:
 *
 * - stays where it is while a file that does not move still has its place;
 * - goes when its files now sit in several places, as a whole letter folder
 *   kept as one show was made for files that were never one title;
 * - moves when its files now sit in one place no other file reaches, no
 *   other Fix match moves to, and no Fix match staying holds;
 * - otherwise stays, as when setting flat merges titles into one place: it
 *   applies to nothing there, and again once the layout is set back.
 *
 * Files under none of the roots are left out.
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
  const placed = rows.flatMap((file) => {
    const root = roots.find((candidate) => isUnder({ path: file.path, root: candidate }))
    if (root == null) return []
    const folder = relative(
      titleRootOf({ root, path: file.path, kind, layout }),
      dirname(file.path),
    )
    return [{ file, folder }]
  })
  const moved = placed.filter(({ file, folder }) => folder !== file.folder)
  const kept = new Set(
    placed
      .filter(({ file, folder }) => folder === file.folder)
      .flatMap(({ file }) => Object.values(fixPlacesOf({ kind, file }))),
  )
  const reached = groupBy({
    items: placed.flatMap(({ file, folder }) =>
      Object.values(fixPlacesOf({ kind, file: { folder, fileName: file.fileName } })).map(
        (place) => ({ place, id: file.id }),
      ),
    ),
    key: (entry) => entry.place,
  })
  const sources = groupBy({
    items: moved.flatMap(({ file, folder }) => fixMovesOf({ kind, file, folder })),
    key: (pair) => pair.from,
  })
  const fateOf = (from: string): FixFate => {
    if (kept.has(from)) return { from, fate: 'stays' }
    const pairs = sources.get(from) ?? []
    const targets = [...new Set(pairs.map((pair) => pair.to))]
    const [to] = targets
    if (to == null || to === from) return { from, fate: 'stays' }
    if (targets.length > 1) return { from, fate: 'goes' }
    const covered = new Set(pairs.map((pair) => pair.id))
    const isShared = (reached.get(to) ?? []).some((entry) => !covered.has(entry.id))
    return isShared ? { from, fate: 'stays' } : { from, fate: 'moves', to }
  }
  const fates = overrides.map(fateOf)
  const claims = groupBy({
    items: fates.flatMap((fixed) => (fixed.fate === 'moves' ? [fixed.to] : [])),
    key: (to) => to,
  })
  const unshared = fates.map((fixed): FixFate =>
    fixed.fate === 'moves' && (claims.get(fixed.to)?.length ?? 0) > 1
      ? { from: fixed.from, fate: 'stays' }
      : fixed,
  )
  return {
    moves: moved.map(({ file, folder }) => ({ id: file.id, folder })),
    overrides: holdTaken(unshared).flatMap((fixed): RelayoutPlan['overrides'] => {
      switch (fixed.fate) {
        case 'stays':
          return []
        case 'goes':
          return [{ from: fixed.from, to: null }]
        case 'moves':
          return [{ from: fixed.from, to: fixed.to }]
        default: {
          const unknown: never = fixed
          return unknown
        }
      }
    }),
  }
}
