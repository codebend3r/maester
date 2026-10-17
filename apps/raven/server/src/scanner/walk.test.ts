import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { type Gate, createGate } from '@/scanner/concurrency'
import { outermost, walkVideos } from '@/scanner/walk'

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
    expect(result.unreadable).toEqual([])
  })

  it('tells how many videos each folder held as it reads it, adding up to what it found', async () => {
    const counts: number[] = []
    const result = await walkVideos({
      roots: [at('Movies'), at('TV')],
      onFound: (count) => counts.push(count),
    })
    expect(counts.length).toBeGreaterThan(1)
    expect(counts.reduce((sum, count) => sum + count, 0)).toBe(result.files.length)
  })

  it('reports a path that does not exist instead of throwing', async () => {
    const result = await walkVideos({ roots: [at('Nope'), at('TV')] })
    expect(result.unreadable).toEqual([at('Nope')])
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
    // Stat: Movies and TV themselves. Readdir: Movies, Heat, TV, Show, Season 1. Stat: the
    // symlink, then the three videos.
    expect(counts.calls).toBe(11)
    expect(counts.peak).toBe(2)
  })

  it('takes a known file as `known` says, without a stat, and reads the rest', async () => {
    const inner = createGate({ limit: 2 })
    const counts = { calls: 0 }
    const gate: Gate = {
      run: (task) => {
        counts.calls += 1
        return inner.run(task)
      },
    }
    const result = await walkVideos({
      roots: [at('Movies')],
      gate,
      known: (path) => (path.endsWith('.mkv') ? { size: 99, mtimeMs: 7 } : null),
    })
    const files = result.files
      .map(({ path, size, mtimeMs }) => ({ path, size, mtimeMs }))
      .toSorted((a, b) => a.path.localeCompare(b.path))
    expect(files).toEqual([
      { path: at('Movies', 'Heat (1995)', 'Heat (1995).mkv'), size: 99, mtimeMs: 7 },
      { path: at('Movies', 'linked.mp4'), size: 20, mtimeMs: expect.any(Number) },
    ])
    // Stat: Movies. Readdir: Movies, Heat. Stat: the symlink, then linked.mp4; never the mkv.
    expect(counts.calls).toBe(5)
  })

  it('reports a file under overlapping paths once', async () => {
    const result = await walkVideos({ roots: [at('TV'), at('TV', 'Show')] })
    expect(result.files).toHaveLength(1)
    expect(result.files[0]?.root).toBe(at('TV'))
  })

  describe('at places under the paths', () => {
    const roots = () => [at('Movies'), at('TV')]

    it('walks a folder that changed, keeping the library path as the root', async () => {
      const result = await walkVideos({ roots: roots(), places: [at('TV', 'Show')] })
      expect(result.files.map((file) => [file.path, file.root])).toEqual([
        [at('TV', 'Show', 'Season 1', 'Show - S01E01.mp4'), at('TV')],
      ])
      expect(result.unreadable).toEqual([])
    })

    it('takes a file as it is, and leaves out what the walk would skip', async () => {
      const result = await walkVideos({
        roots: roots(),
        places: [
          at('Movies', 'Heat (1995)', 'Heat (1995).mkv'),
          at('Movies', 'Heat (1995)', 'Heat (1995)-sample.mkv'),
          at('Movies', 'Heat (1995)', 'Heat (1995).srt'),
          at('Movies', '@eaDir', 'thumb.mp4'),
          at('Elsewhere', 'film.mp4'),
        ],
      })
      expect(result.files.map((file) => file.path)).toEqual([
        at('Movies', 'Heat (1995)', 'Heat (1995).mkv'),
      ])
    })

    it('finds nothing where a place has gone, and says nothing of it', async () => {
      const result = await walkVideos({ roots: roots(), places: [at('Movies', 'Gone (2001)')] })
      expect(result).toEqual({ files: [], unreadable: [], errors: [] })
    })

    it('reports the library path when it is missing too, so the index keeps what it had', async () => {
      const result = await walkVideos({
        roots: [at('Unmounted')],
        places: [at('Unmounted', 'Gone (2001)')],
      })
      expect(result.unreadable).toEqual([at('Unmounted')])
    })
  })
})

describe('outermost', () => {
  it('keeps the places not under another, once each', () => {
    expect(
      outermost([
        '/m/Ronin (1998)/Ronin (1998).mkv',
        '/m/Ronin (1998)',
        '/m/Heat (1995)/heat.mkv',
        '/m/Ronin (1998)',
        '/m/Ronin (1998) Extras',
      ]),
    ).toEqual(['/m/Ronin (1998)', '/m/Heat (1995)/heat.mkv', '/m/Ronin (1998) Extras'])
  })
})
