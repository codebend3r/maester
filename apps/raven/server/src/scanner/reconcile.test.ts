import { describe, expect, it } from 'vitest'
import { type IndexedFile, changesAnything, reconcile } from '@/scanner/reconcile'
import type { FoundFile } from '@/scanner/walk'

type FoundProps = {
  path: string
  size?: number
  mtimeMs?: number
}

const found = ({ path, size = 100, mtimeMs = 1 }: FoundProps): FoundFile => ({
  path,
  root: '/m',
  size,
  mtimeMs,
})

const known = (
  entries: Array<[string, Partial<IndexedFile> & { id: number }]>,
): Map<string, IndexedFile> =>
  new Map(entries.map(([path, file]) => [path, { size: 100, mtimeMs: 1, probed: true, ...file }]))

describe('reconcile', () => {
  it('adds what is new, drops what went, and leaves the rest', () => {
    const changes = reconcile({
      known: known([
        ['/m/kept.mp4', { id: 1 }],
        ['/m/gone.mp4', { id: 2, size: 50 }],
      ]),
      found: [found({ path: '/m/kept.mp4' }), found({ path: '/m/new.mp4', size: 70 })],
    })
    expect(changes).toEqual({
      added: [found({ path: '/m/new.mp4', size: 70 })],
      moved: [],
      changed: [],
      gone: [2],
      unprobed: [],
    })
  })

  it('follows a file renamed or moved: the same size and time under a new path', () => {
    const changes = reconcile({
      known: known([['/m/Old Name.mp4', { id: 4, size: 300, mtimeMs: 9 }]]),
      found: [found({ path: '/m/Folder/New Name.mp4', size: 300, mtimeMs: 9 })],
    })
    expect(changes.moved).toEqual([
      { id: 4, file: found({ path: '/m/Folder/New Name.mp4', size: 300, mtimeMs: 9 }) },
    ])
    expect(changes.added).toEqual([])
    expect(changes.gone).toEqual([])
  })

  it('will not guess between files that look the same', () => {
    const changes = reconcile({
      known: known([
        ['/m/a.mp4', { id: 1 }],
        ['/m/b.mp4', { id: 2 }],
      ]),
      found: [found({ path: '/m/c.mp4' }), found({ path: '/m/d.mp4' })],
    })
    expect(changes.moved).toEqual([])
    expect(changes.gone).toEqual([1, 2])
    expect(changes.added.map((file) => file.path)).toEqual(['/m/c.mp4', '/m/d.mp4'])
  })

  it('re-probes a file replaced in place, and one never probed', () => {
    const changes = reconcile({
      known: known([
        ['/m/replaced.mp4', { id: 1 }],
        ['/m/unprobed.mp4', { id: 2, probed: false }],
      ]),
      found: [
        found({ path: '/m/replaced.mp4', size: 200, mtimeMs: 5 }),
        found({ path: '/m/unprobed.mp4' }),
      ],
    })
    expect(changes.changed).toEqual([
      { id: 1, file: found({ path: '/m/replaced.mp4', size: 200, mtimeMs: 5 }) },
    ])
    expect(changes.unprobed).toEqual([{ id: 2, path: '/m/unprobed.mp4' }])
    expect(changesAnything(changes)).toBe(true)
  })

  it('has nothing to write when the disk matches the index', () => {
    const changes = reconcile({
      known: known([['/m/kept.mp4', { id: 1, probed: false }]]),
      found: [found({ path: '/m/kept.mp4' })],
    })
    expect(changesAnything(changes)).toBe(false)
  })
})
