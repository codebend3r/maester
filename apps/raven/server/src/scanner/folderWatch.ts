import { type FSWatcher, watch } from 'node:fs'
import { join } from 'node:path'
import { foldersUnder, isUnder } from '@/scanner/walk'

/** A watch that has stopped once closed. */
export type Watching = { close: () => void }

/**
 * Watches everything under `root`: `onChange` gets each path that was
 * added, removed, renamed or written, and `onError` the failure that
 * stopped the watch (the path is not there, the share went away, or the
 * system ran out of watches). Failures are reported, never thrown.
 */
export type WatchFolder = (args: {
  root: string
  onChange: (path: string) => void
  onError: (error: unknown) => void
}) => Watching

/** macOS and Windows watch a whole tree with one native watch. */
export const watchTree: WatchFolder = ({ root, onChange, onError }) => {
  try {
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

/**
 * Linux's inotify watches one folder at a time, and Node's own recursive
 * watch there stats and watches every file synchronously, which a big
 * library on a network share cannot afford. So each folder is watched by
 * itself, found by the same walk a scan does, and a folder that turns up
 * is walked and watched in turn; one that goes is let go.
 */
export const watchEachFolder: WatchFolder = ({ root, onChange, onError }) => {
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
      const watcher = watch(folder, { persistent: false }, (event, name) => {
        const path = name == null ? folder : join(folder, name)
        onChange(path)
        // Only a rename adds or takes away a folder; a change is a file being written.
        if (event === 'rename') void follow(path)
      })
      // A folder deleted under the watch errors here; only the root's matters.
      watcher.on('error', (error) => {
        forget(folder)
        if (folder === root) onError(error)
      })
      watchers.set(folder, watcher)
    } catch (error) {
      onError(error)
    }
  }

  /** A changed path that is a folder now gets watched, with everything under it; one gone is let go. */
  const follow = async (path: string) => {
    const folders = await foldersUnder({ root: path })
    if (folders.length === 0) forget(path)
    folders.forEach(add)
  }

  const start = async () => {
    const folders = await foldersUnder({ root })
    if (folders.length === 0) onError(new Error(`Could not read ${root}.`))
    folders.forEach(add)
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
  process.platform === 'linux' ? watchEachFolder(args) : watchTree(args)
