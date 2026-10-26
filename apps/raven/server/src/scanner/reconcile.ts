import { groupBy } from '@/groupBy'
import type { FoundFile } from '@/scanner/walk'

/** What the scanner compares against the disk to find new, changed, moved and gone files. */
export type IndexedFile = {
  id: number
  size: number
  mtimeMs: number
  probed: boolean
}

/** What a look at the disk changes in the index. */
export type Reconciled = {
  /** New to the index. */
  added: FoundFile[]
  /** Renamed or moved: an indexed file's size and modification time, under a new path. */
  moved: Array<{ id: number; file: FoundFile }>
  /** Replaced in place: the same path with a new size or modification time. */
  changed: Array<{ id: number; file: FoundFile }>
  /** Indexed, and no longer there. */
  gone: number[]
  /** Unchanged, but never probed: a probe timed out last time. */
  unprobed: Array<{ id: number; path: string }>
}

type IdentityProps = { size: number; mtimeMs: number }

/** A rename keeps both, so two files sharing them are taken for one. */
const identity = ({ size, mtimeMs }: IdentityProps): string => `${size}:${mtimeMs}`

type IsReplacedProps = { indexed: IndexedFile; file: FoundFile }

/** Still at its path, but with a new size or modification time. */
const isReplaced = ({ indexed, file }: IsReplacedProps): boolean =>
  indexed.size !== file.size || indexed.mtimeMs !== file.mtimeMs

type ReconcileProps = {
  known: ReadonlyMap<string, IndexedFile>
  found: readonly FoundFile[]
}

/**
 * Compares what the index holds for the places looked at with what was
 * found there. A file that went and one that came with the same size and
 * modification time are the same file moved, as long as no other file
 * shares them; otherwise it is one removal and one addition.
 */
export const reconcile = ({ known, found }: ReconcileProps): Reconciled => {
  const foundPaths = new Set(found.map((file) => file.path))
  const missing = [...known.entries()]
    .filter(([path]) => !foundPaths.has(path))
    .map(([, file]) => file)
  const fresh = found.filter((file) => !known.has(file.path))

  const missingByIdentity = groupBy({ items: missing, key: identity })
  const moved = [...groupBy({ items: fresh, key: identity }).entries()].flatMap(([key, files]) => {
    const was = missingByIdentity.get(key) ?? []
    const [file] = files
    const [before] = was
    return files.length === 1 && was.length === 1 && file && before ? [{ id: before.id, file }] : []
  })
  const movedIds = new Set(moved.map(({ id }) => id))
  const movedPaths = new Set(moved.map(({ file }) => file.path))

  const stayed = found.flatMap((file) => {
    const indexed = known.get(file.path)
    return indexed ? [{ indexed, file }] : []
  })
  return {
    added: fresh.filter((file) => !movedPaths.has(file.path)),
    moved,
    changed: stayed.filter(isReplaced).map(({ indexed, file }) => ({ id: indexed.id, file })),
    gone: missing.filter((file) => !movedIds.has(file.id)).map((file) => file.id),
    unprobed: stayed
      .filter((entry) => !isReplaced(entry) && !entry.indexed.probed)
      .map(({ indexed, file }) => ({ id: indexed.id, path: file.path })),
  }
}

/** Whether the index has anything to write. */
export const changesAnything = ({ added, moved, changed, gone }: Reconciled): boolean =>
  added.length + moved.length + changed.length + gone.length > 0
