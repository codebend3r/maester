import { DOWNLOAD_KINDS, DOWNLOAD_STATUS_KINDS } from '@raven/core'
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

  it('loads EMPTY_DOWNLOADS for a missing file, and set nothing aside', async () => {
    const { fs, files } = createFakeFs()
    expect(await load(fs)).toEqual({ state: EMPTY_DOWNLOADS, wasSetAside: false })
    expect(files.size).toBe(0)
  })

  it('keeps an unreadable file as .corrupt-<now>, loads empty and says it set one aside', async () => {
    const { fs, files } = createFakeFs({ [FILE]: '{"version":1,' })
    expect(await load(fs)).toEqual({ state: EMPTY_DOWNLOADS, wasSetAside: true })
    expect(files.has(FILE)).toBe(false)
    expect(files.get(`${FILE}.corrupt-${NOW}`)).toBe('{"version":1,')
  })

  it('keeps valid JSON of the wrong shape, and says it set one aside', async () => {
    const text = JSON.stringify({ version: 1, entries: [{ status: { kind: 'stalled' } }] })
    const { fs, files } = createFakeFs({ [FILE]: text })
    expect(await load(fs)).toEqual({ state: EMPTY_DOWNLOADS, wasSetAside: true })
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
          serverPosition: 0,
          pending: NO_PENDING,
          createdAt: 1,
        },
      ],
    })
    const { fs } = createFakeFs({ [FILE]: JSON.stringify(written) })
    expect(await load(fs)).toEqual({ state: written, wasSetAside: false })
  })

  it('upgrades a version 1 file, whose pending and owed belong to no account', async () => {
    const SERVER_ID = '11111111-1111-4111-8111-111111111111'
    const notedBefore = { play: true, position: 120, furthest: 300, at: 5 }
    const entryV1 = {
      downloadId: '00000000-0000-4000-8000-000000000001',
      serverId: SERVER_ID,
      mediaId: 1,
      label: 'The Two Towers',
      group: { kind: DOWNLOAD_KINDS.movie, key: 'movie:1', title: 'The Two Towers', order: 0 },
      container: 'mkv',
      size: 1000,
      duration: null,
      watchedPercent: 90,
      sidecars: [],
      status: { kind: DOWNLOAD_STATUS_KINDS.ready },
      autoDelete: true,
      watchedAt: null,
      serverPosition: 0,
      pending: notedBefore,
      createdAt: 1,
    }
    const owedV1 = { serverId: SERVER_ID, mediaId: 2, pending: notedBefore }
    const text = JSON.stringify({
      version: 1,
      entries: [entryV1],
      autoDeleteDefault: true,
      owed: [owedV1],
    })
    const { fs, files } = createFakeFs({ [FILE]: text })
    const shared = { ...notedBefore, accountId: null }
    expect(await load(fs)).toEqual({
      state: {
        ...EMPTY_DOWNLOADS,
        entries: [{ ...entryV1, pending: shared }],
        autoDeleteDefault: true,
        owed: [{ ...owedV1, pending: shared }],
      },
      wasSetAside: false,
    })
    expect(EMPTY_DOWNLOADS.version).toBe(2)
    expect(files.get(FILE)).toBe(text)
  })
})
