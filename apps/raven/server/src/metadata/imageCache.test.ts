import { mkdtemp, readFile, rm, stat, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DEFAULT_PLAYBACK_SETTINGS, POSTER_WIDTHS } from '@raven/core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { readServerConfig } from '@/config'
import { FfmpegService } from '@/ffmpeg/ffmpegService'
import { ImageCache } from '@/metadata/imageCache'
import { encodeImage, jpegSize } from '@/test/clips'
import { FAKE_JPEG } from '@/test/fakeTmdb'

const exists = (path: string): Promise<boolean> =>
  stat(path).then(
    () => true,
    () => false,
  )

describe('the image cache', () => {
  const state: { root: string; calls: string[]; cache: ImageCache | null } = {
    root: '',
    calls: [],
    cache: null,
  }
  const cache = (): ImageCache => {
    if (!state.cache) throw new Error('cache not made')
    return state.cache
  }
  const widthOf = async (path: string | null): Promise<number> =>
    jpegSize(await readFile(path ?? '')).width

  beforeAll(async () => {
    state.root = await mkdtemp(join(tmpdir(), 'raven-images-'))
    const config = { ...readServerConfig({}), dataDir: join(state.root, 'data') }
    state.cache = new ImageCache(
      config,
      async (url) => {
        state.calls.push(url)
        return new Response(FAKE_JPEG, { headers: { 'content-type': 'image/jpeg' } })
      },
      new FfmpegService(config, { playback: () => DEFAULT_PLAYBACK_SETTINGS }),
    )
  })

  afterAll(async () => {
    await rm(state.root, { recursive: true, force: true })
  })

  it('fetches a TMDB poster at the width asked for, once for each width', async () => {
    const first = await Promise.all(
      POSTER_WIDTHS.map((width) => cache().tmdb({ path: '/heat.jpg', width })),
    )
    expect(new Set(first).size).toBe(3)
    const again = await Promise.all(
      POSTER_WIDTHS.map((width) => cache().tmdb({ path: '/heat.jpg', width })),
    )
    expect(again).toEqual(first)
    expect(state.calls.filter((url) => url.endsWith('/heat.jpg')).toSorted()).toEqual([
      'https://image.tmdb.org/t/p/w185/heat.jpg',
      'https://image.tmdb.org/t/p/w342/heat.jpg',
      'https://image.tmdb.org/t/p/w500/heat.jpg',
    ])
  })

  it('scales a picture beside the media to each width once, and never wider than it is', async () => {
    const source = join(state.root, 'Heat (1995)', 'poster.jpg')
    await encodeImage({ path: source, size: '400x600' })
    const at = (width: 185 | 342 | 500) =>
      cache().local({ itemId: 7, kind: 'poster', source, width })
    const [narrow, middle, own] = await Promise.all([at(185), at(342), at(500)])
    expect(await widthOf(narrow)).toBe(185)
    expect(await widthOf(middle)).toBe(342)
    expect(await widthOf(own)).toBe(400)
    expect(await at(185)).toBe(narrow)
  })

  it('makes every width of a picture beside the media again once it changes', async () => {
    const source = join(state.root, 'Ronin (1998)', 'poster.jpg')
    await encodeImage({ path: source, size: '400x600' })
    const at = (width: 185 | 342) => cache().local({ itemId: 8, kind: 'poster', source, width })
    const before = await Promise.all([at(185), at(342)])
    const later = new Date(Date.now() + 60_000)
    await utimes(source, later, later)
    const after = await at(185)
    expect(after).not.toBe(before[0])
    expect(await Promise.all(before.map((path) => exists(path ?? '')))).toEqual([false, false])
    expect(await widthOf(await at(342))).toBe(342)
  })

  it('serves what a raven before widths cached, and replaces its local scales', async () => {
    const images = join(state.root, 'data', 'images')
    await writeFile(join(images, 'tmdb', 'w500', 'cached.jpg'), FAKE_JPEG)
    expect(await cache().tmdb({ path: '/cached.jpg', width: 500 })).toBe(
      join(images, 'tmdb', 'w500', 'cached.jpg'),
    )
    expect(state.calls.some((url) => url.endsWith('/cached.jpg'))).toBe(false)

    const source = join(state.root, 'Thief (1981)', 'poster.jpg')
    await encodeImage({ path: source, size: '400x600' })
    const old = join(images, 'local', `9-poster-${Math.round((await stat(source)).mtimeMs)}.jpg`)
    await writeFile(old, FAKE_JPEG)
    expect(
      await widthOf(await cache().local({ itemId: 9, kind: 'poster', source, width: 500 })),
    ).toBe(400)
    expect(await exists(old)).toBe(false)
  })

  it('sweeps the TMDB pictures nothing shows any more, at every width', async () => {
    const kept = await Promise.all(
      POSTER_WIDTHS.map((width) => cache().tmdb({ path: '/kept.jpg', width })),
    )
    const gone = await Promise.all(
      POSTER_WIDTHS.map((width) => cache().tmdb({ path: '/gone.jpg', width })),
    )
    await cache().sweep({ tmdbPaths: new Set(['/kept.jpg']), itemIds: new Set([7, 8]) })
    expect(await Promise.all(kept.map((path) => exists(path ?? '')))).toEqual([true, true, true])
    expect(await Promise.all(gone.map((path) => exists(path ?? '')))).toEqual([false, false, false])
  })
})
