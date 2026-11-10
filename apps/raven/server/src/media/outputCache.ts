import { mkdirSync } from 'node:fs'
import { mkdir, readdir, rename, rm, stat, utimes } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { Logger } from '@nestjs/common'
import { errorMessage } from '@/errorMessage'
import { temporary } from '@/fileNames'
import type { MediaIndex } from '@/media/mediaIndex'

const SWEEP_MS = 6 * 60 * 60 * 1000

/** A dot-file older than this was left by a run the server never finished, such as one cut by a restart. */
const ABANDONED_MS = 24 * 60 * 60 * 1000

const MEDIA_FOLDER = /^\d+$/

type Cached = { path: string; size: number; servedAt: number }

type CreateOutputCacheProps = {
  /** The folder every media's folder of outputs goes in; made when missing. */
  root: string
  /** The bytes the outputs may take, past which the least recently served go. */
  cap: number
  /** The folder of a media no longer indexed goes at the sweep. */
  index: Pick<MediaIndex, 'fileOf'>
  /** What the outputs are called when a sweep fails: "the transcodes". */
  what: string
  logger: Pick<Logger, 'warn'>
}

type OutputCachePathOfProps = { mediaId: number; name: string }

type OutputCacheWriteProps = {
  /** The finished file, in its media's folder under the root. */
  target: string
  /** What every file made of the same version of the media starts with; the other versions go once this one lands. */
  version: string
  extension: string
  /** Fills the hidden temporary file given, which becomes `target` once it resolves and goes when it rejects. */
  run: (temp: string) => Promise<void>
}

type OutputCacheSweepProps = {
  /** Bytes an output about to be made needs inside the cap. */
  reserve?: number
}

type OutputCacheKeptProps = { dir: string; now: number }

/**
 * Files made of media, on disk as `<root>/<mediaId>/<version>…`, kept to a cap: past it the
 * least recently served go first, by the sweep at start, every six hours and when asked,
 * which also drops the folders of media no longer indexed and the temporary files of runs
 * abandoned. A file that is held is never evicted, and the most recently served one always
 * stays, even when it alone is past the cap.
 */
export type OutputCache = {
  readonly root: string
  /** `<root>/<mediaId>/<name>`. */
  pathOf: (props: OutputCachePathOfProps) => string
  /** Writes `target` through a temporary beside it, then removes the folder's other versions that are not held. */
  write: (props: OutputCacheWriteProps) => Promise<void>
  /** Marks the file served now, the order the sweep evicts in. Its mtime stays: the name holds the version. */
  touch: (path: string) => Promise<void>
  /** Keeps the file from eviction, for a response sending it, until the release returned is called. */
  hold: (path: string) => () => void
  sweep: (props?: OutputCacheSweepProps) => Promise<void>
  /** Sweeps now and every six hours, until `stop`. */
  start: () => void
  stop: () => void
}

/** The finished files in one media's folder, after removing the dot-files runs abandoned. */
const kept = async ({ dir, now }: OutputCacheKeptProps): Promise<Cached[]> => {
  const names = await readdir(dir).catch((): string[] => [])
  const files = await Promise.all(
    names.map(async (name): Promise<Cached[]> => {
      const path = join(dir, name)
      const info = await stat(path).catch(() => null)
      if (info === null || !info.isFile()) return []
      if (!name.startsWith('.')) return [{ path, size: info.size, servedAt: info.atimeMs }]
      if (now - info.mtimeMs > ABANDONED_MS) await rm(path, { force: true })
      return []
    }),
  )
  return files.flat()
}

export const createOutputCache = ({
  root,
  cap,
  index,
  what,
  logger,
}: CreateOutputCacheProps): OutputCache => {
  mkdirSync(root, { recursive: true })
  const held = new Map<string, number>()
  const state: { timer: NodeJS.Timeout | null } = { timer: null }

  const sweep = async ({ reserve = 0 }: OutputCacheSweepProps = {}): Promise<void> => {
    const now = Date.now()
    const folders = await readdir(root).catch((): string[] => [])
    const found = await Promise.all(
      folders.map(async (name) => {
        const dir = join(root, name)
        if (MEDIA_FOLDER.test(name) && index.fileOf(Number(name)) !== null) {
          return kept({ dir, now })
        }
        await rm(dir, { recursive: true, force: true })
        return []
      }),
    )
    const room = cap - reserve
    const { evicted } = found
      .flat()
      .toSorted((a, b) => b.servedAt - a.servedAt)
      .reduce<{ total: number; evicted: Cached[] }>(
        ({ total, evicted: before }, file, at) => {
          const after = total + file.size
          const isEvicted = at > 0 && after > room && !held.has(file.path)
          return { total: after, evicted: isEvicted ? [...before, file] : before }
        },
        { total: 0, evicted: [] },
      )
    await Promise.all(evicted.map(({ path }) => rm(path, { force: true })))
  }

  const swept = (): Promise<void> =>
    sweep().catch((error: unknown) =>
      logger.warn(`Could not sweep ${what}: ${errorMessage(error)}`),
    )

  const release = (path: string): void => {
    const count = (held.get(path) ?? 0) - 1
    if (count > 0) {
      held.set(path, count)
      return
    }
    held.delete(path)
  }

  return {
    root,
    pathOf: ({ mediaId, name }) => join(root, String(mediaId), name),
    write: async ({ target, version, extension, run }) => {
      const dir = dirname(target)
      await mkdir(dir, { recursive: true })
      const temp = temporary({ dir, extension })
      try {
        await run(temp)
        await rename(temp, target)
      } catch (error) {
        await rm(temp, { force: true })
        throw error
      }
      const files = await readdir(dir).catch((): string[] => [])
      await Promise.all(
        files
          .filter((file) => !file.startsWith('.') && !file.startsWith(version))
          .map((file) => join(dir, file))
          .filter((file) => !held.has(file))
          .map((file) => rm(file, { force: true })),
      )
    },
    touch: async (path) => {
      const info = await stat(path)
      await utimes(path, new Date(), info.mtime)
    },
    hold: (path) => {
      held.set(path, (held.get(path) ?? 0) + 1)
      const once = { isHeld: true }
      return () => {
        if (!once.isHeld) return
        once.isHeld = false
        release(path)
      }
    },
    sweep,
    start: () => {
      void swept()
      state.timer = setInterval(swept, SWEEP_MS)
      state.timer.unref()
    },
    stop: () => {
      if (state.timer) clearInterval(state.timer)
      state.timer = null
    },
  }
}
