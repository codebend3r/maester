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

/** The places that hold a file: one at a title root, its title's and its own elsewhere. */
const placesIn = (places: FixPlaces): string[] =>
  places.title === places.own ? [places.own] : [places.title, places.own]

/** What becomes of one Fix match: it stays where it is, goes, or moves to one new place. */
type FixFate = { from: string } & (
  | { fate: 'stays' }
  | { fate: 'goes' }
  | { fate: 'moves'; to: string; isOwn: boolean }
)

/**
 * Reads every file's place again for the library's type and folder layout.
 * Only files whose folder changes move. A Fix match never ends up at a place
 * whose files include one it did not cover before:
 *
 * - when its files now sit under several places, it goes, as a whole letter
 *   folder kept as one show was made for files that were never one title;
 * - when they sit under one new place that holds none of anyone else's, it
 *   moves there, or stays when that is where it was;
 * - otherwise it stays where it was if nothing else came there, applying to
 *   nothing until the layout is set back, and goes if something did.
 *
 * When a file's own Fix match and its folder's would land on one place, its
 * own moves and the other goes. Files under none of the roots are left out.
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
    return [
      {
        id: file.id,
        folder,
        isMoved: folder !== file.folder,
        before: fixPlacesOf({ kind, file }),
        after: fixPlacesOf({ kind, file: { folder, fileName: file.fileName } }),
      },
    ]
  })
  const under = (side: 'before' | 'after') =>
    groupBy({
      items: placed.flatMap((file) => placesIn(file[side]).map((place) => ({ place, file }))),
      key: (entry) => entry.place,
    })
  const before = under('before')
  const after = under('after')
  const fateOf = (from: string): FixFate => {
    const covered = (before.get(from) ?? []).map((entry) => entry.file)
    const ids = new Set(covered.map((file) => file.id))
    const gainsNothing = (place: string) =>
      (after.get(place) ?? []).every((entry) => ids.has(entry.file.id))
    const where: FixFate = gainsNothing(from) ? { from, fate: 'stays' } : { from, fate: 'goes' }
    // A file takes a Fix match kept at its own place to its own, and one kept at its title's to its title's.
    const targets = [
      ...new Set(
        covered.map((file) => (from === file.before.own ? file.after.own : file.after.title)),
      ),
    ]
    const [to] = targets
    if (to == null) return where
    if (targets.length > 1) return { from, fate: 'goes' }
    if (to === from || !gainsNothing(to)) return where
    return { from, fate: 'moves', to, isOwn: covered.every((file) => file.before.own === from) }
  }
  const fates = overrides.map(fateOf)
  const rivals = groupBy({
    items: fates.flatMap((fixed) => (fixed.fate === 'moves' ? [fixed] : [])),
    key: (fixed) => fixed.to,
  })
  return {
    moves: placed.flatMap((file) => (file.isMoved ? [{ id: file.id, folder: file.folder }] : [])),
    overrides: fates.flatMap((fixed): RelayoutPlan['overrides'] => {
      switch (fixed.fate) {
        case 'stays':
          return []
        case 'goes':
          return [{ from: fixed.from, to: null }]
        case 'moves': {
          const claims = rivals.get(fixed.to) ?? []
          const isWinner =
            claims.length === 1 ||
            (fixed.isOwn && claims.filter((claim) => claim.isOwn).length === 1)
          return [{ from: fixed.from, to: isWinner ? fixed.to : null }]
        }
        default: {
          const unknown: never = fixed
          return unknown
        }
      }
    }),
  }
}
