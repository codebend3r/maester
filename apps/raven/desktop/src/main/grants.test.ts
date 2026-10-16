import { describe, expect, it } from 'bun:test'
import { createGrants, type GrantFs } from '@/main/grants'

type Entry = { real: string; isFile: boolean; size: number; mtimeMs: number }

const missing = (path: string): Error =>
  Object.assign(new Error(`ENOENT: no such file or directory, '${path}'`), { code: 'ENOENT' })

const setup = (entries: Record<string, Partial<Entry>>) => {
  const table = new Map(
    Object.entries(entries).map(([path, entry]) => [
      path,
      { real: path, isFile: true, size: 100, mtimeMs: 1000, ...entry },
    ]),
  )
  const fs: GrantFs = {
    realpath: async (path) => {
      const entry = table.get(path)
      if (!entry) throw missing(path)
      return entry.real
    },
    stat: async (path) => {
      const entry = table.get(path)
      if (!entry) throw missing(path)
      return { isFile: () => entry.isFile, size: entry.size, mtimeMs: entry.mtimeMs }
    },
  }
  const counter = { n: 0 }
  const grants = createGrants({
    fs,
    newId: () => {
      counter.n += 1
      return `id-${counter.n}`
    },
  })
  return { grants, table }
}

describe('grant', () => {
  it('grants a video and finds it again by id', async () => {
    const { grants } = setup({ '/m/Film.mkv': { size: 5, mtimeMs: 7 } })
    const result = await grants.grant('/m/Film.mkv')
    expect(result).toEqual({
      ok: true,
      file: { fileId: 'id-1', path: '/m/Film.mkv', name: 'Film.mkv', size: 5, mtimeMs: 7 },
    })
    expect(grants.fileOf('id-1')).toEqual(result.ok ? result.file : null)
    expect(grants.fileOf('unknown')).toBeNull()
  })

  it('refuses a relative path as missing', async () => {
    const { grants } = setup({ 'relative/Film.mkv': {} })
    expect(await grants.grant('relative/Film.mkv')).toEqual({ ok: false, reason: 'missing' })
  })

  it('refuses a path that does not exist as missing', async () => {
    const { grants } = setup({})
    expect(await grants.grant('/m/gone.mkv')).toEqual({ ok: false, reason: 'missing' })
  })

  it('refuses a non-video as not-a-video', async () => {
    const { grants } = setup({ '/m/notes.txt': {} })
    expect(await grants.grant('/m/notes.txt')).toEqual({ ok: false, reason: 'not-a-video' })
  })

  it('refuses a directory named like a video as not-a-file', async () => {
    const { grants } = setup({ '/m/Season 1.mkv': { isFile: false } })
    expect(await grants.grant('/m/Season 1.mkv')).toEqual({ ok: false, reason: 'not-a-file' })
  })

  it('judges a symlink by its real path: a link to a video plays', async () => {
    const { grants } = setup({
      '/m/link.mp4': { real: '/m/Film.mp4' },
      '/m/Film.mp4': {},
    })
    const result = await grants.grant('/m/link.mp4')
    expect(result.ok && result.file.path).toBe('/m/Film.mp4')
    expect(result.ok && result.file.name).toBe('Film.mp4')
  })

  it('refuses a symlink named like a video that points at a non-video', async () => {
    const { grants } = setup({
      '/m/trailer.mp4': { real: '/home/me/.ssh/id_rsa' },
      '/home/me/.ssh/id_rsa': {},
    })
    expect(await grants.grant('/m/trailer.mp4')).toEqual({ ok: false, reason: 'not-a-video' })
  })

  it('refuses a symlink to a video when its own name is not a video', async () => {
    const { grants } = setup({ '/m/link.txt': { real: '/m/Film.mp4' }, '/m/Film.mp4': {} })
    expect(await grants.grant('/m/link.txt')).toEqual({ ok: false, reason: 'not-a-video' })
  })

  it('returns the same id for the same real path, with the size refreshed', async () => {
    const { grants, table } = setup({
      '/m/Film.mkv': { size: 1, mtimeMs: 1 },
      '/m/link.mkv': { real: '/m/Film.mkv' },
    })
    const first = await grants.grant('/m/Film.mkv')
    const entry = table.get('/m/Film.mkv')
    if (entry) {
      entry.size = 2
      entry.mtimeMs = 9
    }
    const second = await grants.grant('/m/link.mkv')
    expect(first.ok && second.ok && second.file.fileId).toBe(first.ok ? first.file.fileId : '')
    expect(second.ok && second.file.size).toBe(2)
    expect(second.ok && second.file.mtimeMs).toBe(9)
    expect(grants.fileOf('id-1')!.size).toBe(2)
  })

  it('grants a unicode name with spaces and parentheses', async () => {
    const { grants } = setup({ '/m/Été 02 (1080p).mkv': {} })
    const result = await grants.grant('/m/Été 02 (1080p).mkv')
    expect(result.ok && result.file.name).toBe('Été 02 (1080p).mkv')
  })
})
