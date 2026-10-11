import type { Dirent } from 'node:fs'
import { readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { extensionOf, isVideoFile } from '@raven/core'
import type { FoundFile } from '@/media/mediaRepository'
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

export type WalkResult = {
  files: FoundFile[]
  /** Library paths that could not be read at all (unmounted share, typo, missing volume). */
  unreadableRoots: string[]
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
        .filter(
          ({ kind, entry }) => kind === 'file' && isVideoFile(entry.name) && !isSample(entry.name),
        )
        .map(({ entry }) => join(dir, entry.name)),
      error: null,
    }
  } catch (error) {
    return { dirs: [], files: [], error: `${dir}: ${reason(error)}` }
  }
}

/** Breadth-first, one level at a time, so no more than `limit` folders are open at once. */
const walkRoot = async ({
  root,
  limit,
  gate,
}: {
  root: string
  limit: number
  gate: Gate
}): Promise<{ files: string[]; errors: string[]; readable: boolean }> => {
  const level = async ({
    dirs,
    files,
    errors,
  }: {
    dirs: string[]
    files: string[]
    errors: string[]
  }): Promise<{ files: string[]; errors: string[] }> => {
    if (dirs.length === 0) return { files, errors }
    const listings = await mapWithConcurrency({
      items: dirs,
      limit,
      fn: (dir) => list({ dir, gate }),
    })
    return level({
      dirs: listings.flatMap((listing) => listing.dirs),
      files: [...files, ...listings.flatMap((listing) => listing.files)],
      errors: [...errors, ...listings.flatMap((listing) => (listing.error ? [listing.error] : []))],
    })
  }

  const top = await list({ dir: root, gate })
  if (top.error) return { files: [], errors: [top.error], readable: false }
  const rest = await level({ dirs: top.dirs, files: top.files, errors: [] })
  return { ...rest, readable: true }
}

/**
 * Every video file under the given library paths, with the size and mtime
 * the scanner diffs against the index. A file reachable from two overlapping
 * paths is reported once, under the first. `limit` caps the folders and
 * files this walk has open; `gate` caps filesystem calls across every walk
 * that shares it.
 */
export const walkVideos = async ({
  roots,
  limit = 16,
  gate = SCAN_FILESYSTEM,
}: {
  roots: readonly string[]
  limit?: number
  gate?: Gate
}): Promise<WalkResult> => {
  const walked = await Promise.all(
    roots.map(async (root) => ({ root, ...(await walkRoot({ root, limit, gate })) })),
  )
  const seen = new Set<string>()
  const candidates = walked.flatMap(({ root, files }) =>
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
    unreadableRoots: walked.filter(({ readable }) => !readable).map(({ root }) => root),
    errors: walked.flatMap(({ errors }) => errors),
  }
}
