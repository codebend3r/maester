import { type FSWatcher, type WatchEventType, type WatchListener, statSync, watch } from 'node:fs'
import { statfs } from 'node:fs/promises'
import { join } from 'node:path'
import { isRecord } from '@raven/core'
import { ERROR_CODES } from '@/errorMessage'
import { mapWithConcurrency } from '@/scanner/concurrency'
import { foldersUnder, isUnder } from '@/scanner/walk'

/** The `fs.watch` event a folder watch follows up. */
const WATCH_EVENTS = { rename: 'rename' } as const satisfies Record<string, WatchEventType>

/** The `process.platform` whose `fs.watch` cannot watch a whole tree at once. */
const PLATFORMS = { linux: 'linux', darwin: 'darwin' } as const satisfies Record<
  string,
  NodeJS.Platform
>

/** A watch that has stopped once closed. */
export type Watching = { close: () => void }

type WatchFolderProps = {
  root: string
  onChange: (path: string) => void
  onError: (error: unknown) => void
}

/**
 * Watches everything under `root`: `onChange` gets each path that was
 * added, removed, renamed or written, and `onError` the failure that
 * stopped the watch (the path is not there, the share went away, or the
 * system ran out of watches). Failures are reported, never thrown.
 */
export type WatchFolder = (args: WatchFolderProps) => Watching

/** The system has no watches left to give, which no later folder will fix. */
const isOutOfWatches = (error: unknown): boolean =>
  isRecord(error) && (error.code === ERROR_CODES.enospc || error.code === ERROR_CODES.emfile)

/** macOS and Windows watch a whole tree with one native watch. */
export const watchTree: WatchFolder = ({ root, onChange, onError }) => {
  try {
    // Node 24's recursive watch on Linux neither throws nor errors when the root is not there.
    statSync(root)
    const watcher = watch(root, { recursive: true, persistent: false }, (_event, name) =>
      onChange(name == null ? root : join(root, name)),
    )
    watcher.on('error', onError)
    return { close: () => watcher.close() }
  } catch (error) {
    onError(error)
    return { close: () => undefined }
  }
}

type WatchOneProps = { folder: string; listener: WatchListener<string> }

/** One folder's own watch, set up synchronously: `fs.watch`, or a test's slower stand-in. */
export type WatchOne = (args: WatchOneProps) => FSWatcher

const watchOneFolder: WatchOne = ({ folder, listener }) =>
  watch(folder, { persistent: false }, listener)

/** Lets the event loop answer what waits (requests, timers) before the next synchronous step. */
const nextTurn = (): Promise<void> => new Promise((resolve) => setImmediate(resolve))

type WatchEachFolderProps = WatchFolderProps & { watchOne?: WatchOne }

/**
 * Linux's inotify watches one folder at a time, and Node's own recursive
 * watch there stats and watches every file synchronously, which a big
 * library on a network share cannot afford. So each folder is watched by
 * itself, found by the same walk a scan does, and a folder that turns up
 * is walked and watched in turn; one that goes is let go.
 *
 * Each watch blocks the event loop while the kernel looks the folder up,
 * a network round trip on a cifs share (1 to 50 ms on Vhagar), so the
 * folders are watched one per turn of the loop: thousands of them at once
 * would hold every request for half a minute.
 */
export const watchEachFolder = ({
  root,
  onChange,
  onError,
  watchOne = watchOneFolder,
}: WatchEachFolderProps): Watching => {
  const watchers = new Map<string, FSWatcher>()
  const state = { closed: false }

  const forget = (path: string) =>
    [...watchers.entries()]
      .filter(([folder]) => isUnder({ path: folder, root: path }))
      .forEach(([folder, watcher]) => {
        watcher.close()
        watchers.delete(folder)
      })

  const add = (folder: string) => {
    if (state.closed || watchers.has(folder)) return
    try {
      const watcher = watchOne({
        folder,
        listener: (event, name) => {
          const path = name == null ? folder : join(folder, name)
          onChange(path)
          // Only a rename adds or takes away a folder; a change is a file being written.
          if (event === WATCH_EVENTS.rename) void follow(path)
        },
      })
      // A folder deleted under the watch errors here; only the root's matters.
      watcher.on('error', (error) => {
        forget(folder)
        if (folder === root) onError(error)
      })
      watchers.set(folder, watcher)
    } catch (error) {
      // A subfolder that went before it could be watched is its parent's
      // news, which the parent's watch reports; only the root, or running
      // out of watches, stops the watch.
      if (folder === root || isOutOfWatches(error)) onError(error)
    }
  }

  /** Watches each folder in turn, letting the event loop run between one and the next, until closed. */
  const addAll = async (folders: readonly string[]): Promise<void> => {
    await mapWithConcurrency({
      items: folders,
      limit: 1,
      fn: async (folder) => {
        if (state.closed) return
        add(folder)
        await nextTurn()
      },
    })
  }

  /** A changed path that is a folder now gets watched, with everything under it; one gone is let go. */
  const follow = async (path: string) => {
    const folders = await foldersUnder({ root: path })
    if (folders.length === 0) forget(path)
    await addAll(folders)
  }

  const start = async () => {
    const folders = await foldersUnder({ root })
    if (folders.length === 0) onError(new Error(`Could not read ${root}.`))
    await addAll(folders)
  }

  void start()
  return {
    close: () => {
      state.closed = true
      forget(root)
    },
  }
}

/** Watches a library path the cheapest way the platform has. */
export const watchFolder: WatchFolder = (args) =>
  process.platform === PLATFORMS.linux ? watchEachFolder(args) : watchTree(args)

/**
 * Linux's `statfs` magic numbers of the file systems mounted from another
 * machine: CIFS, SMB2 and 3, NFS and FUSE (sshfs, rclone).
 */
const NETWORK_FILE_SYSTEMS: ReadonlySet<number> = new Set([
  0xff534d42, 0xfe534d42, 0x517b, 0x6969, 0x65735546,
])

/** macOS mounts its shares under here, and gives no stable number for their type. */
const MAC_VOLUMES = '/Volumes/'

/**
 * Whether `root` is on a share mounted from another machine, whose watch
 * never hears of a change made there (another NAS writing to its own disk).
 * A root that cannot be read counts as one, so the quick scan still looks.
 */
export type IsNetworkShare = (root: string) => Promise<boolean>

export const isNetworkShare: IsNetworkShare = async (root) => {
  if (process.platform === PLATFORMS.darwin) return root.startsWith(MAC_VOLUMES)
  if (process.platform !== PLATFORMS.linux) return true
  try {
    const { type } = await statfs(root)
    return NETWORK_FILE_SYSTEMS.has(type)
  } catch {
    return true
  }
}
