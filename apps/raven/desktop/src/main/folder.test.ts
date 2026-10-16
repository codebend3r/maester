import { describe, expect, it } from 'bun:test'
import type { GrantedFile, Grants } from '@/main/grants'
import { followingVideos, grantNext, NEXT_ATTEMPTS } from '@/main/folder'

describe('followingVideos', () => {
  const siblings = [
    'Episode 10.mkv',
    'Episode 2.mkv',
    'Episode 1.mkv',
    '._Episode 2.mkv',
    'Episode 2.srt',
    'cover.jpg',
    '.DS_Store',
  ]

  it('skips decoys and orders naturally', () => {
    expect(followingVideos({ current: 'Episode 1.mkv', siblings })).toEqual([
      'Episode 2.mkv',
      'Episode 10.mkv',
    ])
  })

  it('gives nothing after the last video', () => {
    expect(followingVideos({ current: 'Episode 10.mkv', siblings })).toEqual([])
  })

  it('still finds a next when the current file is gone', () => {
    expect(followingVideos({ current: 'Episode 3.mkv', siblings })).toEqual(['Episode 10.mkv'])
  })

  it('does not mutate the siblings', () => {
    const copy = [...siblings]
    followingVideos({ current: 'Episode 1.mkv', siblings })
    expect(siblings).toEqual(copy)
  })
})

const fakeGrants = (refused: (path: string) => boolean) => {
  const calls: string[] = []
  const grants: Grants = {
    grant: async (path) => {
      calls.push(path)
      if (refused(path)) return { ok: false, reason: 'missing' }
      const file: GrantedFile = {
        fileId: `id:${path}`,
        path,
        name: path.split('/').pop() ?? path,
        size: 1,
        mtimeMs: 1,
      }
      return { ok: true, file }
    },
    fileOf: () => null,
  }
  return { grants, calls }
}

describe('grantNext', () => {
  it('skips a refused candidate and grants the following one', async () => {
    const { grants, calls } = fakeGrants((path) => path === '/m/Episode 2.mkv')
    const next = await grantNext({
      path: '/m/Episode 1.mkv',
      readdir: async () => ['Episode 1.mkv', 'Episode 2.mkv', 'Episode 3.mkv'],
      grants,
    })
    expect(next!.path).toBe('/m/Episode 3.mkv')
    expect(calls).toEqual(['/m/Episode 2.mkv', '/m/Episode 3.mkv'])
  })

  it('gives null when the folder cannot be read', async () => {
    const { grants, calls } = fakeGrants(() => false)
    const next = await grantNext({
      path: '/m/Episode 1.mkv',
      readdir: async () => {
        throw new Error('EACCES')
      },
      grants,
    })
    expect(next).toBeNull()
    expect(calls).toEqual([])
  })

  it('gives null when nothing follows', async () => {
    const { grants } = fakeGrants(() => false)
    const next = await grantNext({
      path: '/m/Episode 2.mkv',
      readdir: async () => ['Episode 1.mkv', 'Episode 2.mkv'],
      grants,
    })
    expect(next).toBeNull()
  })

  it('tries at most NEXT_ATTEMPTS candidates', async () => {
    const { grants, calls } = fakeGrants(() => true)
    const names = Array.from({ length: 21 }, (_, index) => `E${String(index).padStart(2, '0')}.mkv`)
    const next = await grantNext({ path: '/m/E00.mkv', readdir: async () => names, grants })
    expect(next).toBeNull()
    expect(NEXT_ATTEMPTS).toBe(10)
    expect(calls).toHaveLength(10)
  })
})
