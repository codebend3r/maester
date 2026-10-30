import type { Dirent } from 'node:fs'
import { lstat, readdir, stat } from 'node:fs/promises'
import { basename, join, relative, sep } from 'node:path'
import { extensionOf } from '@raven/core'
import { type Gate, createGate, mapWithConcurrency } from '@/scanner/concurrency'

/**
 * Folders that are never media: NAS housekeeping (Synology's @eaDir holds
 * its own thumbnails, #recycle its recycle bin), OS litter, and anything
 * hidden (checked separately, by the leading dot).
 */
export const SKIPPED_FOLDERS = {
  eaDir: '@eaDir',
  recycle: '#recycle',
  snapshot: '#snapshot',
  recycleBin: '$RECYCLE.BIN',
  systemVolumeInformation: 'System Volume Information',
  lostAndFound: 'lost+found',
} as const

const SKIPPED_NAMES: ReadonlySet<string> = new Set(Object.values(SKIPPED_FOLDERS))

/** What a walk finds at a path it can use. */
const ENTRY_KINDS = { dir: 'dir', file: 'file' } as const

type EntryKind = (typeof ENTRY_KINDS)[keyof typeof ENTRY_KINDS]

/**
 * Every scan's readdir and stat calls, across every library, pass through
 * this one gate. Node runs file calls on a small pool of worker threads (16,
 * see `threadpool.ts`), and the player's file reads use the same pool; over
 * SMB a stat takes about 90ms, so a scan left unchecked fills the pool and
 * video stalls behind it. Four for scans leaves the rest for playback
 * whatever is being scanned.
 */
export const SCAN_FILESYSTEM: Gate = createGate({ limit: 4 })

const isSkippedName = (name: string): boolean => name.startsWith('.') || SKIPPED_NAMES.has(name)

/** Release samples ("movie-sample.mkv", "Sample/sample.mkv") would clutter every movie. */
const isSample = (fileName: string): boolean => {
  const stem = fileName.slice(0, fileName.length - extensionOf(fileName).length - 1)
  return /(^|[-._ ])sample$/i.test(stem)
}

type IsIndexedProps = {
  fileName: string
  /** The extensions the library indexes: its videos, or its audio files. */
  extensions: readonly string[]
}

const isIndexed = ({ fileName, extensions }: IsIndexedProps): boolean =>
  extensions.includes(extensionOf(fileName)) && !isSample(fileName)

/** A video file a walk found, with what the scanner diffs against the index. */
export type FoundFile = {
  path: string
  /** The library path the walk found it under. */
  root: string
  size: number
  mtimeMs: number
}

type IsUnderProps = { path: string; root: string }

/** Whether `path` is `root` or lies under it. */
export const isUnder = ({ path, root }: IsUnderProps): boolean =>
  path === root || path.startsWith(root.endsWith('/') ? root : `${root}/`)

/** The places not already under another: a folder copied in arrives with each of its files. */
export const outermost = (places: readonly string[]): string[] => {
  const distinct = [...new Set(places)]
  return distinct.filter(
    (place) => !distinct.some((other) => other !== place && isUnder({ path: place, root: other })),
  )
}

type IsSkippedPlaceProps = { root: string; path: string }

/** Whether a walk from `root` would skip `path`: it sits in, or is, a hidden or NAS folder. */
export const isSkippedPlace = ({ root, path }: IsSkippedPlaceProps): boolean =>
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

const reason = (error: unknown): string => {
  if (!(error instanceof Error)) return String(error)
  return 'code' in error && typeof error.code === 'string' ? error.code : error.message
}

type ClassifyProps = {
  dir: string
  entry: Dirent
  gate: Gate
}

/** A symlink is followed to a file, never to a folder, so a loop cannot trap the walk. */
const classify = async ({ dir, entry, gate }: ClassifyProps): Promise<EntryKind | null> => {
  if (entry.isDirectory()) return ENTRY_KINDS.dir
  if (entry.isFile()) return ENTRY_KINDS.file
  if (!entry.isSymbolicLink()) return null
  const target = await gate.run(() => stat(join(dir, entry.name))).catch(() => null)
  return target?.isFile() ? ENTRY_KINDS.file : null
}

type ListProps = { dir: string; gate: Gate; extensions: readonly string[] }

const list = async ({ dir, gate, extensions }: ListProps): Promise<Listing> => {
  try {
    const entries = await gate.run(() => readdir(dir, { withFileTypes: true }))
    const kinds = await Promise.all(
      entries
        .filter((entry) => !isSkippedName(entry.name))
        .map(async (entry) => ({ entry, kind: await classify({ dir, entry, gate }) })),
    )
    return {
      dirs: kinds
        .filter(({ kind }) => kind === ENTRY_KINDS.dir)
        .map(({ entry }) => join(dir, entry.name)),
      files: kinds
        .filter(
          ({ kind, entry }) =>
            kind === ENTRY_KINDS.file && isIndexed({ fileName: entry.name, extensions }),
        )
        .map(({ entry }) => join(dir, entry.name)),
      error: null,
    }
  } catch (error) {
    return { dirs: [], files: [], error: `${dir}: ${reason(error)}` }
  }
}

type Tree = { files: string[]; folders: string[]; errors: string[]; readable: boolean }

type WalkTreeProps = {
  root: string
  limit: number
  gate: Gate
  extensions: readonly string[]
  /** Told how many videos each folder held, as each is read. */
  onFound?: (count: number) => void
}

/** Breadth-first, one level at a time, so no more than `limit` folders are open at once. */
const walkTree = async ({
  root,
  limit,
  gate,
  extensions,
  onFound,
}: WalkTreeProps): Promise<Tree> => {
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
      fn: async (dir) => {
        const listing = await list({ dir, gate, extensions })
        if (listing.files.length > 0) onFound?.(listing.files.length)
        return listing
      },
    })
    return level({
      dirs: listings.flatMap((listing) => listing.dirs),
      files: [...files, ...listings.flatMap((listing) => listing.files)],
      folders: [...folders, ...dirs],
      errors: [...errors, ...listings.flatMap((listing) => (listing.error ? [listing.error] : []))],
    })
  }

  const top = await list({ dir: root, gate, extensions })
  if (top.error) return { files: [], folders: [], errors: [top.error], readable: false }
  if (top.files.length > 0) onFound?.(top.files.length)
  const rest = await level({ dirs: top.dirs, files: top.files, folders: [root], errors: [] })
  return { ...rest, readable: true }
}

type FoldersUnderProps = {
  root: string
  limit?: number
  gate?: Gate
}

/** Every folder at and under `root` that a walk enters, for watching them one by one. */
export const foldersUnder = async ({
  root,
  limit = 16,
  gate = SCAN_FILESYSTEM,
}: FoldersUnderProps): Promise<string[]> =>
  (await walkTree({ root, limit, gate, extensions: [] })).folders

type KindOfProps = {
  place: string
  root: string
  gate: Gate
}

/**
 * What is at a place: a folder, a file, or nothing. A library path is
 * followed wherever it leads; below one, a symlink counts only when it leads
 * to a file, as in the walk.
 */
const kindOf = async ({ place, root, gate }: KindOfProps): Promise<EntryKind | null> => {
  const info = await gate.run(() => (place === root ? stat(place) : lstat(place))).catch(() => null)
  if (info?.isDirectory()) return ENTRY_KINDS.dir
  if (info?.isFile()) return ENTRY_KINDS.file
  if (!info?.isSymbolicLink()) return null
  const target = await gate.run(() => stat(place)).catch(() => null)
  return target?.isFile() ? ENTRY_KINDS.file : null
}

type Look = { files: string[]; errors: string[]; unreadable: string | null }

type LookAtProps = {
  place: string
  root: string
  limit: number
  gate: Gate
  extensions: readonly string[]
  onFound?: (count: number) => void
}

/**
 * The media files at one place under a library path. A folder is walked and a
 * file taken as it is. A place that is not there holds nothing, so what the
 * index had there has gone, unless its library path is missing too, which
 * says the share is down rather than the files deleted.
 */
const lookAt = async ({
  place,
  root,
  limit,
  gate,
  extensions,
  onFound,
}: LookAtProps): Promise<Look> => {
  const kind = await kindOf({ place, root, gate })
  if (kind === ENTRY_KINDS.dir) {
    const tree = await walkTree({ root: place, limit, gate, extensions, onFound })
    return { files: tree.files, errors: tree.errors, unreadable: tree.readable ? null : place }
  }
  if (kind === ENTRY_KINDS.file) {
    const files = isIndexed({ fileName: basename(place), extensions }) ? [place] : []
    return { files, errors: [], unreadable: null }
  }
  const rootThere =
    place !== root && (await kindOf({ place: root, root, gate })) === ENTRY_KINDS.dir
  return { files: [], errors: [], unreadable: rootThere ? null : root }
}

/** The size and modification time a walk may take for a file instead of reading them. */
export type KnownStats = Pick<FoundFile, 'size' | 'mtimeMs'>

type WalkVideosProps = {
  roots: readonly string[]
  /** The extensions the library indexes, by its type: `extensionsFor`. */
  extensions: readonly string[]
  places?: readonly string[]
  limit?: number
  gate?: Gate
  /** Once aborted, every filesystem call the walk has left fails at once, so it ends quickly. */
  signal?: AbortSignal
  /** Told how many videos each folder held as the walk reads it, for a count that climbs. */
  onFound?: (count: number) => void
  /** What is already known of a file at this path, or null to read it from disk. */
  known?: (path: string) => KnownStats | null
}

/**
 * Every media file of the library's type at the given places under its paths, with the
 * size and mtime the scanner diffs against the index; a full scan's places
 * are the paths themselves. Places outside the paths, or in a folder the
 * walk skips, are passed over. A file reachable from two overlapping paths
 * is reported once, under the first. `limit` caps the folders and files
 * this walk has open; `gate` caps filesystem calls across every walk that
 * shares it. A file `known` answers for is taken as it says, without a
 * stat: a quick scan reads only the folders and the files new to it.
 */
export const walkVideos = async ({
  roots,
  extensions,
  places = roots,
  limit = 16,
  gate: sharedGate = SCAN_FILESYSTEM,
  signal,
  onFound,
  known = () => null,
}: WalkVideosProps): Promise<WalkResult> => {
  const gate: Gate = signal
    ? {
        run: (task) =>
          sharedGate.run(async () => {
            signal.throwIfAborted()
            return task()
          }),
      }
    : sharedGate
  const looked = await Promise.all(
    places
      .flatMap((place) => {
        const root = roots.find((candidate) => isUnder({ path: place, root: candidate }))
        return root == null || isSkippedPlace({ root, path: place }) ? [] : [{ place, root }]
      })
      .map(async ({ place, root }) => ({
        root,
        ...(await lookAt({ place, root, limit, gate, extensions, onFound })),
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
      const had = known(path)
      if (had) return [{ path, root, size: had.size, mtimeMs: had.mtimeMs }]
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
