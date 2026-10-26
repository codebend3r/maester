import { mkdir, mkdtemp, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { type WatchFolder, type Watching, watchEachFolder, watchTree } from '@/scanner/folderWatch'

type EventuallyProps = {
  check: () => boolean
  ms?: number
}

/** Resolves once `check` holds, polling, or fails after `ms`. */
const eventually = async ({ check, ms = 5_000 }: EventuallyProps): Promise<void> => {
  const until = Date.now() + ms
  const poll = async (): Promise<void> => {
    if (check()) return
    if (Date.now() > until) throw new Error('timed out waiting')
    await new Promise((resolve) => setTimeout(resolve, 25))
    return poll()
  }
  return poll()
}

const WAYS: Array<[string, WatchFolder]> = [
  ['the whole tree at once', watchTree],
  ['folder by folder', watchEachFolder],
]

describe.each(WAYS)('watching %s', (_way, watchFolder) => {
  const state: { root: string; seen: string[]; errors: unknown[]; watch: Watching | null } = {
    root: '',
    seen: [],
    errors: [],
    watch: null,
  }

  beforeEach(async () => {
    state.root = await mkdtemp(join(tmpdir(), 'raven-watch-'))
    await mkdir(join(state.root, 'Movies', 'Heat (1995)'), { recursive: true })
    state.seen = []
    state.errors = []
    state.watch = watchFolder({
      root: state.root,
      onChange: (path) => state.seen.push(path),
      onError: (error) => state.errors.push(error),
    })
    // The first walk and the watches it sets up take a moment.
    await new Promise((resolve) => setTimeout(resolve, 300))
  })

  afterEach(async () => {
    state.watch?.close()
    await rm(state.root, { recursive: true, force: true })
  })

  it('reports a file added deep in the tree', async () => {
    const file = join(state.root, 'Movies', 'Heat (1995)', 'Heat (1995).mkv')
    await writeFile(file, 'x')
    await eventually({ check: () => state.seen.includes(file) })
  })

  it('watches a folder that turns up, and what is put in it', async () => {
    const folder = join(state.root, 'Movies', 'Ronin (1998)')
    await mkdir(folder)
    await eventually({ check: () => state.seen.includes(folder) })
    await new Promise((resolve) => setTimeout(resolve, 300))
    const file = join(folder, 'Ronin (1998).mkv')
    await writeFile(file, 'x')
    await eventually({ check: () => state.seen.includes(file) })
  })

  it('reports both ends of a rename', async () => {
    const before = join(state.root, 'Movies', 'Heat (1995)', 'heat.mkv')
    const after = join(state.root, 'Movies', 'Heat (1995)', 'Heat (1995).mkv')
    await writeFile(before, 'x')
    await eventually({ check: () => state.seen.includes(before) })
    await rename(before, after)
    await eventually({ check: () => state.seen.includes(after) })
    expect(state.errors).toEqual([])
  })

  it('says so when the path is not there', async () => {
    const errors: unknown[] = []
    const watch = watchFolder({
      root: join(state.root, 'Nope'),
      onChange: () => undefined,
      onError: (error) => errors.push(error),
    })
    await eventually({ check: () => errors.length > 0 })
    watch.close()
  })
})
