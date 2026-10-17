import { copyFile, mkdtemp, rename, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { NestFastifyApplication } from '@nestjs/platform-fastify'
import type { ApiClient, Library, MediaItem } from '@raven/core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createApp } from '@/app'
import { MetadataService } from '@/metadata/metadataService'
import { ScannerService } from '@/scanner/scannerService'
import { adminCookie, NOT_WATCHING, testConfig } from '@/test/app'
import { encodeClip } from '@/test/clips'
import { apiFor } from '@/test/server'
import { ThumbnailService } from '@/thumbnails/thumbnailService'

/** As a browser with the admin lock off, so the library can be added and rescanned. */
describe('a quick scan', () => {
  const state: {
    root: string
    media: string
    data: string
    admin: string
    libraryId: number
    app: NestFastifyApplication | null
  } = { root: '', media: '', data: '', admin: '', libraryId: 0, app: null }
  const app = (): NestFastifyApplication => {
    if (!state.app) throw new Error('app not started')
    return state.app
  }
  const api = (): ApiClient => apiFor({ app: app(), cookie: state.admin })
  const at = (...parts: string[]) => join(state.media, ...parts)
  const start = async (): Promise<void> => {
    state.app = await createApp({
      config: testConfig({ dataDir: state.data, mediaDir: state.root }),
      quiet: true,
      watch: NOT_WATCHING,
    })
    await state.app.init()
    state.admin = await adminCookie(state.app)
  }
  const settle = async (): Promise<void> => {
    await app().get(ScannerService).whenIdle(state.libraryId)
    await app().get(MetadataService).whenIdle()
    await app().get(ThumbnailService).whenIdle()
  }
  const quickScan = async (): Promise<void> => {
    app().get(ScannerService).quickScan(state.libraryId)
    await settle()
  }
  const library = (): Promise<Library> => api().getLibrary(state.libraryId)
  const listMedia = (): Promise<MediaItem[]> => api().listMedia({ libraryId: state.libraryId })
  const byName = (items: MediaItem[]): Map<string, MediaItem> =>
    new Map(items.map((item) => [item.fileName, item]))

  beforeAll(async () => {
    state.root = await mkdtemp(join(tmpdir(), 'raven-quick-'))
    state.media = join(state.root, 'media')
    state.data = join(state.root, 'data')
    await encodeClip({ path: at('Heat (1995).mp4'), seconds: 2 })
    await encodeClip({ path: at('Collateral (2004).mp4'), seconds: 2 })
    await encodeClip({ path: at('Thief (1981).mp4'), seconds: 2 })
    await start()
    const created = await api().createLibrary({ name: 'Quick', paths: [state.media] })
    state.libraryId = created.id
    await settle()
  })

  afterAll(async () => {
    await settle()
    await state.app?.close()
    await rm(state.root, { recursive: true, force: true })
  })

  it('starts from a full scan that remembers when it finished, and no quick scan yet', async () => {
    const { scan } = await library()
    expect(scan.state).toBe('idle')
    expect(scan.finishedAt).toEqual(expect.any(String))
    expect(scan.quickScannedAt).toBeNull()
  })

  it('takes in an added video, follows a renamed one and drops a deleted one', async () => {
    const before = byName(await listMedia())
    const heat = before.get('Heat (1995).mp4')
    const { scan: fullScan } = await library()
    await copyFile(at('Heat (1995).mp4'), at('Ronin (1998).mp4'))
    await rename(at('Heat (1995).mp4'), at('Heat (1995) 1080p.mp4'))
    await rm(at('Thief (1981).mp4'))

    await quickScan()

    const after = byName(await listMedia())
    expect([...after.keys()].toSorted()).toEqual([
      'Collateral (2004).mp4',
      'Heat (1995) 1080p.mp4',
      'Ronin (1998).mp4',
    ])
    expect(after.get('Heat (1995) 1080p.mp4')?.id).toBe(heat?.id)
    expect(after.get('Ronin (1998).mp4')?.duration).toBeCloseTo(2, 0)
    const { scan } = await library()
    expect(scan.quickScannedAt).toEqual(expect.any(String))
    expect(scan.finishedAt).toBe(fullScan.finishedAt)
    expect(scan.state).toBe('idle')
  })

  it('leaves a video replaced under its name to the next full scan', async () => {
    await encodeClip({ path: at('Collateral (2004).mp4'), seconds: 4 })

    await quickScan()
    expect(byName(await listMedia()).get('Collateral (2004).mp4')?.duration).toBeCloseTo(2, 0)

    await api().scanLibrary(state.libraryId)
    await settle()
    expect(byName(await listMedia()).get('Collateral (2004).mp4')?.duration).toBeCloseTo(4, 0)
  })

  it('still says when each scan was after a restart', async () => {
    const { scan: before } = await library()
    await state.app?.close()
    await start()
    const { scan: after } = await library()
    expect(after).toMatchObject({
      state: 'idle',
      finishedAt: before.finishedAt,
      quickScannedAt: before.quickScannedAt,
    })
  })
})
