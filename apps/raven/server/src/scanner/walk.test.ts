import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { type Gate, createGate } from '@/scanner/concurrency'
import { walkVideos } from '@/scanner/walk'

describe('walkVideos', () => {
  const state = { root: '' }
  const at = (...parts: string[]) => join(state.root, ...parts)

  beforeAll(async () => {
    state.root = await mkdtemp(join(tmpdir(), 'raven-walk-'))
    await mkdir(at('Movies', 'Heat (1995)'), { recursive: true })
    await mkdir(at('Movies', '@eaDir'), { recursive: true })
    await mkdir(at('Movies', '.trash'), { recursive: true })
    await mkdir(at('TV', 'Show', 'Season 1'), { recursive: true })
    await writeFile(at('Movies', 'Heat (1995)', 'Heat (1995).mkv'), 'x'.repeat(10))
    await writeFile(at('Movies', 'Heat (1995)', 'Heat (1995)-sample.mkv'), 'x')
    await writeFile(at('Movies', 'Heat (1995)', 'Heat (1995).srt'), 'x')
    await writeFile(at('Movies', '@eaDir', 'thumb.mp4'), 'x')
    await writeFile(at('Movies', '.trash', 'old.mp4'), 'x')
    await writeFile(at('TV', 'Show', 'Season 1', 'Show - S01E01.mp4'), 'x'.repeat(20))
    await symlink(at('TV', 'Show', 'Season 1', 'Show - S01E01.mp4'), at('Movies', 'linked.mp4'))
  })

  afterAll(async () => {
    await rm(state.root, { recursive: true, force: true })
  })

  it('finds videos, skipping samples, NAS litter, and hidden folders', async () => {
    const result = await walkVideos({ roots: [at('Movies'), at('TV')] })
    const found = result.files.map((file) => file.path.slice(state.root.length)).toSorted()
    expect(found).toEqual([
      '/Movies/Heat (1995)/Heat (1995).mkv',
      '/Movies/linked.mp4',
      '/TV/Show/Season 1/Show - S01E01.mp4',
    ])
    expect(result.files.find((file) => file.path.endsWith('.mkv'))).toMatchObject({
      root: at('Movies'),
      size: 10,
    })
    expect(result.unreadableRoots).toEqual([])
  })

  it('reports a path that does not exist instead of throwing', async () => {
    const result = await walkVideos({ roots: [at('Nope'), at('TV')] })
    expect(result.unreadableRoots).toEqual([at('Nope')])
    expect(result.files).toHaveLength(1)
  })

  it('sends every readdir and stat through the gate, so walks at once share its limit', async () => {
    const inner = createGate({ limit: 2 })
    const counts = { calls: 0, active: 0, peak: 0 }
    const gate: Gate = {
      run: (task) =>
        inner.run(async () => {
          counts.calls += 1
          counts.active += 1
          counts.peak = Math.max(counts.peak, counts.active)
          try {
            return await task()
          } finally {
            counts.active -= 1
          }
        }),
    }
    const [movies, tv] = await Promise.all([
      walkVideos({ roots: [at('Movies')], gate }),
      walkVideos({ roots: [at('TV')], gate }),
    ])
    expect(movies.files).toHaveLength(2)
    expect(tv.files).toHaveLength(1)
    // Readdir: Movies, Heat, TV, Show, Season 1. Stat: the symlink, then the three videos.
    expect(counts.calls).toBe(9)
    expect(counts.peak).toBe(2)
  })

  it('reports a file under overlapping paths once', async () => {
    const result = await walkVideos({ roots: [at('TV'), at('TV', 'Show')] })
    expect(result.files).toHaveLength(1)
    expect(result.files[0]?.root).toBe(at('TV'))
  })
})
