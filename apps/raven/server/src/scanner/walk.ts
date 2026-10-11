import type { Dirent } from 'node:fs'
import { lstat, readdir, stat } from 'node:fs/promises'
import { basename, join, relative, sep } from 'node:path'
import { extensionOf, isVideoFile } from '@raven/core'
import { type Gate, createGate, mapWithConcurrency } from '@/scanner/concurrency'

/**
 * Folders that are never media: NAS housekeeping (Synology's @eaDir holds
 * its own thumbnails, #recycle its recycle bin), OS litter, and anything
 * hidden (checked separately, by the leading dot).
 */
const SKIPPED_FOLDERS: ReadonlySet<string> = new Set([
  '@eaDir',
  '#recycle',
  '#snapshot',
  '$RECYCLE.BIN',
  'System Volume Information',
  'lost+found',
])

/**
 * Every scan's readdir and stat calls, across every library, pass through
 * this one gate. Node runs file calls on a small pool of worker threads (16,
 * see `threadpool.ts`), and the player's file reads use the same pool; over
 * SMB a stat takes about 90ms, so a scan left unchecked fills the pool and
 * video stalls behind it. Four for scans leaves the rest for playback
 * whatever is being scanned.
 */
export const SCAN_FILESYSTEM: Gate = createGate({ limit: 4 })

const isSkippedName = (name: string): boolean => name.startsWith('.') || SKIPPED_FOLDERS.has(name)

/** Release samples ("movie-sample.mkv", "Sample/sample.mkv") would clutter every movie. */
const isSample = (fileName: string): boolean => {
  const stem = fileName.slice(0, fileName.length - extensionOf(fileName).length - 1)
  return /(^|[-._ ])sample$/i.test(stem)
}

const isIndexed = (fileName: string): boolean => isVideoFile(fileName) && !isSample(fileName)

/** A video file a walk found, with what the scanner diffs against the index. */
export type FoundFile = {
  path: string
  /** The library path the walk found it under. */
  root: string
  size: number
  mtimeMs: number
}

/** Whether `path` is `root` or lies under it. */
export const isUnder = ({ path, root }: { path: string; root: string }): boolean =>
  path === root || path.startsWith(root.endsWith('/') ? root : `${root}/`)

/** The places not already under another: a folder copied in arrives with each of its files. */
export const outermost = (places: readonly string[]): string[] => {
  const distinct = [...new Set(places)]
  return distinct.filter(
    (place) => !distinct.some((other) => other !== place && isUnder({ path: place, root: other })),
  )
}

/** Whether a walk from `root` would skip `path`: it sits in, or is, a hidden or NAS folder. */
export const isSkippedPlace = ({ root, path }: { root: string; path: string }): boolean =>
  relative(root, path).split(sep).some(isSkippedName)

export type WalkResult = {
  files: FoundFile[]
  /**
   * Places that could not be read at all (unmounted share, typo, missing
   * volume): a library path, or a folder under one. What the index holds
   * under them stays.
   */
  unreadable: string[]
  /** Subfolders that failed mid-walk, as "path: reason". */
  errors: string[]
}

type Listing = { dirs: string[]; files: string[]; error: string | null }

const reason = (error: unknown): string =>
  error instanceof Error && 'code' in error && typeof error.code === 'string'
    ? error.code
    : error instanceof Error
      ? error.message
      : String(error)

/** A symlink is followed to a file, never to a folder, so a loop cannot trap the walk. */
const classify = async ({
  dir,
  entry,
  gate,
}: {
  dir: string
  entry: Dirent
  gate: Gate
}): Promise<'dir' | 'file' | null> => {
  if (entry.isDirectory()) return 'dir'
  if (entry.isFile()) return 'file'
  if (!entry.isSymbolicLink()) return null
  const target = await gate.run(() => stat(join(dir, entry.name))).catch(() => null)
  return target?.isFile() ? 'file' : null
}

const list = async ({ dir, gate }: { dir: string; gate: Gate }): Promise<Listing> => {
  try {
    const entries = await gate.run(() => readdir(dir, { withFileTypes: true }))
    const kinds = await Promise.all(
      entries
        .filter((entry) => !isSkippedName(entry.name))
        .map(async (entry) => ({ entry, kind: await classify({ dir, entry, gate }) })),
    )
    return {
      dirs: kinds.filter(({ kind }) => kind === 'dir').map(({ entry }) => join(dir, entry.name)),
      files: kinds
        .filter(({ kind, entry }) => kind === 'file' && isIndexed(entry.name))
        .map(({ entry }) => join(dir, entry.name)),
      error: null,
    }
  } catch (error) {
    return { dirs: [], files: [], error: `${dir}: ${reason(error)}` }
  }
}

type Tree = { files: string[]; folders: string[]; errors: string[]; readable: boolean }

/** Breadth-first, one level at a time, so no more than `limit` folders are open at once. */
const walkTree = async ({
  root,
  limit,
  gate,
}: {
  root: string
  limit: number
  gate: Gate
}): Promise<Tree> => {
  const level = async ({
    dirs,
    files,
    folders,
    errors,
  }: Omit<Tree, 'readable'> & { dirs: string[] }): Promise<Omit<Tree, 'readable'>> => {
    if (dirs.length === 0) return { files, folders, errors }
    const listings = await mapWithConcurrency({
      items: dirs,
      limit,
      fn: (dir) => list({ dir, gate }),
    })
    return level({
      dirs: listings.flatMap((listing) => listing.dirs),
      files: [...files, ...listings.flatMap((listing) => listing.files)],
      folders: [...folders, ...dirs],
      errors: [...errors, ...listings.flatMap((listing) => (listing.error ? [listing.error] : []))],
    })
  }

  const top = await list({ dir: root, gate })
  if (top.error) return { files: [], folders: [], errors: [top.error], readable: false }
  const rest = await level({ dirs: top.dirs, files: top.files, folders: [root], errors: [] })
  return { ...rest, readable: true }
}

/** Every folder at and under `root` that a walk enters, for watching them one by one. */
export const foldersUnder = async ({
  root,
  limit = 16,
  gate = SCAN_FILESYSTEM,
}: {
  root: string
  limit?: number
  gate?: Gate
}): Promise<string[]> => (await walkTree({ root, limit, gate })).folders

/**
 * What is at a place: a folder, a file, or nothing. A library path is
 * followed wherever it leads; below one, a symlink counts only when it leads
 * to a file, as in the walk.
 */
const kindOf = async ({
  place,
  root,
  gate,
}: {
  place: string
  root: string
  gate: Gate
}): Promise<'dir' | 'file' | null> => {
  const info = await gate.run(() => (place === root ? stat(place) : lstat(place))).catch(() => null)
  if (info?.isDirectory()) return 'dir'
  if (info?.isFile()) return 'file'
  if (!info?.isSymbolicLink()) return null
  const target = await gate.run(() => stat(place)).catch(() => null)
  return target?.isFile() ? 'file' : null
}

type Look = { files: string[]; errors: string[]; unreadable: string | null }

/**
 * The videos at one place under a library path. A folder is walked and a
 * file taken as it is. A place that is not there holds nothing, so what the
 * index had there has gone, unless its library path is missing too, which
 * says the share is down rather than the files deleted.
 */
const lookAt = async ({
  place,
  root,
  limit,
  gate,
}: {
  place: string
  root: string
  limit: number
  gate: Gate
}): Promise<Look> => {
  const kind = await kindOf({ place, root, gate })
  if (kind === 'dir') {
    const tree = await walkTree({ root: place, limit, gate })
    return { files: tree.files, errors: tree.errors, unreadable: tree.readable ? null : place }
  }
  if (kind === 'file') {
    return { files: isIndexed(basename(place)) ? [place] : [], errors: [], unreadable: null }
  }
  const rootThere = place !== root && (await kindOf({ place: root, root, gate })) === 'dir'
  return { files: [], errors: [], unreadable: rootThere ? null : root }
}

/**
 * Every video file at the given places under a library's paths, with the
 * size and mtime the scanner diffs against the index; a full scan's places
 * are the paths themselves. Places outside the paths, or in a folder the
 * walk skips, are passed over. A file reachable from two overlapping paths
 * is reported once, under the first. `limit` caps the folders and files
 * this walk has open; `gate` caps filesystem calls across every walk that
 * shares it.
 */
export const walkVideos = async ({
  roots,
  places = roots,
  limit = 16,
  gate = SCAN_FILESYSTEM,
}: {
  roots: readonly string[]
  places?: readonly string[]
  limit?: number
  gate?: Gate
}): Promise<WalkResult> => {
  const looked = await Promise.all(
    places
      .flatMap((place) => {
        const root = roots.find((candidate) => isUnder({ path: place, root: candidate }))
        return root == null || isSkippedPlace({ root, path: place }) ? [] : [{ place, root }]
      })
      .map(async ({ place, root }) => ({
        root,
        ...(await lookAt({ place, root, limit, gate })),
      })),
  )
  const seen = new Set<string>()
  const candidates = looked.flatMap(({ root, files }) =>
    files
      .filter((path) => {
        if (seen.has(path)) return false
        seen.add(path)
        return true
      })
      .map((path) => ({ root, path })),
  )
  const stated = await mapWithConcurrency({
    items: candidates,
    limit,
    fn: async ({ root, path }) => {
      const info = await gate.run(() => stat(path)).catch(() => null)
      return info ? [{ path, root, size: info.size, mtimeMs: Math.round(info.mtimeMs) }] : []
    },
  })
  return {
    files: stated.flat(),
    unreadable: [...new Set(looked.flatMap(({ unreadable }) => unreadable ?? []))],
    errors: looked.flatMap(({ errors }) => errors),
  }
}
