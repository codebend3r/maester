import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'bun:test'
import { isOpaqueId } from '@raven/core'
import { createGrants, type GrantFs } from '@/main/grants'

type Entry = { real: string; isFile: boolean; size: number; mtimeMs: number }

const missing = (path: string): Error =>
  Object.assign(new Error(`ENOENT: no such file or directory, '${path}'`), { code: 'ENOENT' })

type SetupProps = {
  entries: Record<string, Partial<Entry>>
  ids?: readonly string[] | null
}

const setup = ({ entries, ids = null }: SetupProps) => {
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
      return ids?.[counter.n - 1] ?? `id-${counter.n}`
    },
  })
  return { grants, table }
}

describe('grant', () => {
  it('grants a video and finds it again by id', async () => {
    const { grants } = setup({ entries: { '/m/Film.mkv': { size: 5, mtimeMs: 7 } } })
    const result = await grants.grant('/m/Film.mkv')
    expect(result).toEqual({
      fileId: 'id-1',
      path: '/m/Film.mkv',
      name: 'Film.mkv',
      size: 5,
      mtimeMs: 7,
    })
    expect(grants.fileOf('id-1')).toEqual(result)
    expect(grants.fileOf('unknown')).toBeNull()
  })

  it('refuses a relative path', async () => {
    const { grants } = setup({ entries: { 'relative/Film.mkv': {} } })
    expect(await grants.grant('relative/Film.mkv')).toBeNull()
  })

  it('refuses a path that does not exist', async () => {
    const { grants } = setup({ entries: {} })
    expect(await grants.grant('/m/gone.mkv')).toBeNull()
  })

  it('refuses a non-video', async () => {
    const { grants } = setup({ entries: { '/m/notes.txt': {} } })
    expect(await grants.grant('/m/notes.txt')).toBeNull()
  })

  it('refuses a directory named like a video', async () => {
    const { grants } = setup({ entries: { '/m/Season 1.mkv': { isFile: false } } })
    expect(await grants.grant('/m/Season 1.mkv')).toBeNull()
  })

  it('judges a symlink by its real path: a link to a video plays', async () => {
    const { grants } = setup({
      entries: {
        '/m/link.mp4': { real: '/m/Film.mp4' },
        '/m/Film.mp4': {},
      },
    })
    const result = await grants.grant('/m/link.mp4')
    expect(result?.path).toBe('/m/Film.mp4')
    expect(result?.name).toBe('Film.mp4')
  })

  it('refuses a symlink named like a video that points at a non-video', async () => {
    const { grants } = setup({
      entries: {
        '/m/trailer.mp4': { real: '/home/me/.ssh/id_rsa' },
        '/home/me/.ssh/id_rsa': {},
      },
    })
    expect(await grants.grant('/m/trailer.mp4')).toBeNull()
  })

  it('refuses a symlink to a video when its own name is not a video', async () => {
    const { grants } = setup({
      entries: { '/m/link.txt': { real: '/m/Film.mp4' }, '/m/Film.mp4': {} },
    })
    expect(await grants.grant('/m/link.txt')).toBeNull()
  })

  it('returns the same id for the same real path, with the size refreshed', async () => {
    const { grants, table } = setup({
      entries: {
        '/m/Film.mkv': { size: 1, mtimeMs: 1 },
        '/m/link.mkv': { real: '/m/Film.mkv' },
      },
    })
    const first = await grants.grant('/m/Film.mkv')
    const entry = table.get('/m/Film.mkv')
    if (entry) {
      entry.size = 2
      entry.mtimeMs = 9
    }
    const second = await grants.grant('/m/link.mkv')
    expect(second?.fileId).toBe(first?.fileId)
    expect(second?.size).toBe(2)
    expect(second?.mtimeMs).toBe(9)
    expect(grants.fileOf('id-1')!.size).toBe(2)
  })

  it('grants a unicode name with spaces and parentheses', async () => {
    const { grants } = setup({ entries: { '/m/Été 02 (1080p).mkv': {} } })
    const result = await grants.grant('/m/Été 02 (1080p).mkv')
    expect(result?.name).toBe('Été 02 (1080p).mkv')
  })
})

describe('grant ids', () => {
  it('draws again when a new id is already taken by another file', async () => {
    const { grants } = setup({
      entries: { '/m/A.mkv': {}, '/m/B.mkv': {} },
      ids: ['dup', 'dup', 'dup', 'fresh'],
    })
    const first = await grants.grant('/m/A.mkv')
    const second = await grants.grant('/m/B.mkv')
    expect(first?.fileId).toBe('dup')
    expect(second?.fileId).toBe('fresh')
    expect(grants.fileOf('dup')!.path).toBe('/m/A.mkv')
    expect(grants.fileOf('fresh')!.path).toBe('/m/B.mkv')
  })

  it('gives up after a bounded number of draws instead of re-pointing an id', async () => {
    const { grants } = setup({
      entries: { '/m/A.mkv': {}, '/m/B.mkv': {} },
      ids: Array(100).fill('dup'),
    })
    await grants.grant('/m/A.mkv')
    await expect(grants.grant('/m/B.mkv')).rejects.toThrow(/unique/)
    expect(grants.fileOf('dup')!.path).toBe('/m/A.mkv')
  })

  it('hands out a read-only view', async () => {
    const { grants } = setup({ entries: { '/m/A.mkv': { size: 5 } } })
    await grants.grant('/m/A.mkv')
    const file = grants.fileOf('id-1')!
    expect(() => {
      // @ts-expect-error fileOf's view is read-only, so a caller cannot re-point a grant.
      file.path = '/etc/passwd'
    }).toThrow()
    expect(grants.fileOf('id-1')!.path).toBe('/m/A.mkv')
  })
})

describe('the ids main makes', () => {
  it('pass the guard the page and the file scheme check every id with', () => {
    expect(isOpaqueId(randomUUID())).toBe(true)
  })
})
