import { describe, expect, it } from 'bun:test'

import { keepReconciled, reconcileDownloads } from '@/downloads/downloadDisk'

type Entry = { path: string; isDone: boolean; cover: string | null }

describe('reconcileDownloads', () => {
  it('fails a finished download whose file went, and deletes every folder nothing finished holds', async () => {
    const files = new Set([
      'downloads/s/1/media.m4a',
      'downloads/s/cover-9/cover.jpg',
      'downloads/s/3/media.m4a.part',
    ])
    const removed: string[] = []
    const entries: Record<string, Entry> = {
      one: { path: 'downloads/s/1/media.m4a', isDone: true, cover: 'downloads/s/cover-9' },
      two: { path: 'downloads/s/2/media.m4a', isDone: true, cover: null },
    }
    const checked = await reconcileDownloads({
      entries,
      disk: {
        exists: (path) => files.has(path),
        folders: () => ['downloads/s/1', 'downloads/s/cover-9', 'downloads/s/3'],
        remove: async (folder) => {
          removed.push(folder)
        },
      },
      isDone: (entry) => entry.isDone,
      pathOf: (entry) => entry.path,
      foldersOf: (entry) => [
        entry.path.split('/').slice(0, -1).join('/'),
        ...(entry.cover === null ? [] : [entry.cover]),
      ],
      failed: (entry) => ({ ...entry, isDone: false }),
    })
    expect(checked.one?.isDone).toBe(true)
    expect(checked.two?.isDone).toBe(false)
    expect(removed).toEqual(['downloads/s/3'])
  })
})

describe('keepReconciled', () => {
  it('lays the answers over only the entries nothing changed meanwhile', () => {
    const read = { a: 'done', b: 'done', c: 'done' }
    const checked = { a: 'failed', b: 'failed', c: 'failed' }
    const now = { a: read.a, b: 'queued', d: 'queued' }
    expect(keepReconciled({ read, checked, now })).toEqual({
      a: 'failed',
      b: 'queued',
      d: 'queued',
    })
  })
})
