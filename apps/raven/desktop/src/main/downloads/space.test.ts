import { describe, expect, it } from 'bun:test'
import {
  DOWNLOADS_DIR,
  downloadsDirFor,
  entryDirFor,
  fits,
  partPathFor,
  readSpace,
  sidecarPathFor,
  SPACE_RESERVE_BYTES,
  videoPathFor,
  type SpaceFs,
} from '@/main/downloads/space'

const USER_DATA = '/data'
const SERVER_ID = '6f1c1c0e-3b0a-4f4e-8a55-0d2f3c5b7e11'
const MEDIA_ID = 42

describe('readSpace', () => {
  it('makes the folder first, then multiplies by the block size', async () => {
    const calls: string[] = []
    const fs: SpaceFs = {
      mkdir: async (path) => {
        calls.push(`mkdir ${path}`)
      },
      statfs: async (path) => {
        calls.push(`statfs ${path}`)
        return { bavail: 10, bsize: 4096, blocks: 100 }
      },
    }
    const space = await readSpace({ fs, dir: '/data/downloads' })
    expect(calls).toEqual(['mkdir /data/downloads', 'statfs /data/downloads'])
    expect(space).toEqual({ free: 40960, total: 409600 })
  })
})

describe('fits', () => {
  it('reserves two gibibytes', () => {
    expect(SPACE_RESERVE_BYTES).toBe(2 * 1024 ** 3)
  })

  it('fits exactly at the boundary and not one byte more', () => {
    const free = 10 * 1024 ** 3
    const bytes = free - SPACE_RESERVE_BYTES
    expect(fits({ bytes, free })).toBe(true)
    expect(fits({ bytes: bytes + 1, free })).toBe(false)
  })
})

describe('path builders', () => {
  const part = { userData: USER_DATA, serverId: SERVER_ID, mediaId: MEDIA_ID }

  it('lays the downloads folder out under userData', () => {
    expect(DOWNLOADS_DIR).toBe('downloads')
    expect(downloadsDirFor({ userData: USER_DATA })).toBe('/data/downloads')
    expect(entryDirFor(part)).toBe(`/data/downloads/${SERVER_ID}/42`)
    expect(videoPathFor({ ...part, container: 'mkv' })).toBe(
      `/data/downloads/${SERVER_ID}/42/video.mkv`,
    )
    expect(partPathFor({ ...part, container: 'mkv' })).toBe(
      `/data/downloads/${SERVER_ID}/42/video.mkv.part`,
    )
    expect(sidecarPathFor({ ...part, trackId: 'external-2' })).toBe(
      `/data/downloads/${SERVER_ID}/42/subtitles/external-2.vtt`,
    )
  })

  it('refuses a container that is not a short lowercase name', () => {
    expect(() => videoPathFor({ ...part, container: '../x' })).toThrow(RangeError)
    expect(() => partPathFor({ ...part, container: 'MKV' })).toThrow(RangeError)
    expect(() => videoPathFor({ ...part, container: 'abcdefghi' })).toThrow(RangeError)
  })

  it('refuses a track id that is not external-<n>', () => {
    expect(() => sidecarPathFor({ ...part, trackId: 'embedded-0' })).toThrow(RangeError)
    expect(() => sidecarPathFor({ ...part, trackId: 'external-../x' })).toThrow(RangeError)
  })

  it('refuses a server id that is not an opaque id', () => {
    const bad = { ...part, serverId: '../etc' }
    expect(() => entryDirFor(bad)).toThrow(RangeError)
    expect(() => videoPathFor({ ...bad, container: 'mkv' })).toThrow(RangeError)
    expect(() => partPathFor({ ...bad, container: 'mkv' })).toThrow(RangeError)
    expect(() => sidecarPathFor({ ...bad, trackId: 'external-1' })).toThrow(RangeError)
  })

  it('refuses a media id that is not a media id', () => {
    expect(() => entryDirFor({ ...part, mediaId: -1 })).toThrow(RangeError)
    expect(() => entryDirFor({ ...part, mediaId: 1.5 })).toThrow(RangeError)
  })
})
