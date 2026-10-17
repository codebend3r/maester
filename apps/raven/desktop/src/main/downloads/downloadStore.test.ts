import { describe, expect, it } from 'bun:test'
import { EMPTY_DOWNLOADS, NO_PENDING, queue } from '@/main/downloads/downloadState'
import { DOWNLOADS_DEBOUNCE_MS, loadDownloads } from '@/main/downloads/downloadStore'
import type { StateFs } from '@/main/stateStore'

const FILE = '/data/downloads.json'
const NOW = 1700000000000

const missing = (): Error => Object.assign(new Error('ENOENT'), { code: 'ENOENT' })

const createFakeFs = (initial: Record<string, string> = {}) => {
  const files = new Map(Object.entries(initial))
  const fs: StateFs = {
    readFile: async (path) => {
      const text = files.get(path)
      if (text === undefined) throw missing()
      return text
    },
    writeFile: async ({ path, data }) => {
      files.set(path, data)
    },
    rename: async ({ from, to }) => {
      const text = files.get(from)
      if (text === undefined) throw missing()
      files.delete(from)
      files.set(to, text)
    },
  }
  return { fs, files }
}

const load = (fs: StateFs) => loadDownloads({ fs, file: FILE, now: () => NOW })

describe('loadDownloads', () => {
  it('debounces writes by a second', () => {
    expect(DOWNLOADS_DEBOUNCE_MS).toBe(1000)
  })

  it('loads EMPTY_DOWNLOADS for a missing file', async () => {
    const { fs, files } = createFakeFs()
    expect(await load(fs)).toEqual(EMPTY_DOWNLOADS)
    expect(files.size).toBe(0)
  })

  it('keeps an unreadable file as .corrupt-<now> and loads empty', async () => {
    const { fs, files } = createFakeFs({ [FILE]: '{"version":1,' })
    expect(await load(fs)).toEqual(EMPTY_DOWNLOADS)
    expect(files.has(FILE)).toBe(false)
    expect(files.get(`${FILE}.corrupt-${NOW}`)).toBe('{"version":1,')
  })

  it('keeps valid JSON of the wrong shape', async () => {
    const text = JSON.stringify({ version: 1, entries: [{ status: { kind: 'stalled' } }] })
    const { fs, files } = createFakeFs({ [FILE]: text })
    expect(await load(fs)).toEqual(EMPTY_DOWNLOADS)
    expect(files.get(`${FILE}.corrupt-${NOW}`)).toBe(text)
  })

  it('loads a valid file as written', async () => {
    const written = queue(EMPTY_DOWNLOADS, {
      entries: [
        {
          downloadId: '00000000-0000-4000-8000-000000000001',
          serverId: '11111111-1111-4111-8111-111111111111',
          mediaId: 1,
          label: 'The Two Towers',
          group: { kind: 'movie', key: 'movie:1', title: 'The Two Towers', order: 0 },
          container: 'mkv',
          size: 1000,
          duration: null,
          watchedPercent: 90,
          sidecars: [],
          status: { kind: 'ready' },
          autoDelete: false,
          watchedAt: null,
          pending: NO_PENDING,
          createdAt: 1,
        },
      ],
    })
    const { fs } = createFakeFs({ [FILE]: JSON.stringify(written) })
    expect(await load(fs)).toEqual(written)
  })
})
