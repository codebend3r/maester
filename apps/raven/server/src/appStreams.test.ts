import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { NestFastifyApplication } from '@nestjs/platform-fastify'
import { type ApiClient, type MediaItem, PLAYBACK_MODES } from '@raven/core'
import { HEADERS } from '@shared/server'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createApp } from '@/app'
import { RAVEN_HEADERS } from '@/http'
import { ScannerService } from '@/scanner/scannerService'
import { adminCookie, testConfig } from '@/test/app'
import { encodeClip } from '@/test/clips'
import { apiFor } from '@/test/server'

const CHROME_MAC =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36'
const ADDRESS = '203.0.113.9'

describe('who is streaming', () => {
  const state: {
    root: string
    media: string
    admin: string
    app: NestFastifyApplication | null
    video: MediaItem | null
  } = { root: '', media: '', admin: '', app: null, video: null }
  const app = (): NestFastifyApplication => {
    if (!state.app) throw new Error('app not started')
    return state.app
  }
  const videoId = (): number => state.video?.id ?? -1
  /** A browser with the admin lock off, and one with it on. */
  const admin = (): ApiClient => apiFor({ app: app(), cookie: state.admin })
  const viewer = (): ApiClient => apiFor({ app: app() })
  /** As the viewer's browser sends it, to the media plane. */
  const asViewer = {
    [HEADERS.range]: 'bytes=0-99',
    [RAVEN_HEADERS.userAgent]: CHROME_MAC,
    [RAVEN_HEADERS.forwardedFor]: `${ADDRESS}, 10.0.0.1`,
  }
  const play = () =>
    app().inject({ method: 'GET', url: `/api/media/${videoId()}/file`, headers: asViewer })

  beforeAll(async () => {
    state.root = await mkdtemp(join(tmpdir(), 'raven-streams-'))
    state.media = join(state.root, 'media')
    await encodeClip({ path: join(state.media, 'Clip (2026).mp4') })
    state.app = await createApp({
      config: testConfig({ dataDir: join(state.root, 'data'), mediaDir: state.media }),
      quiet: true,
    })
    await state.app.init()
    await state.app.getHttpAdapter().getInstance().ready()
    state.admin = await adminCookie(state.app)
    const library = await admin().createLibrary({ name: 'Films', paths: [state.media] })
    await app().get(ScannerService).whenIdle(library.id)
    const [video] = await admin().listMedia({ libraryId: library.id })
    if (!video) throw new Error('nothing indexed')
    state.video = video
  })

  afterAll(async () => {
    await state.app?.close()
    await rm(state.root, { recursive: true, force: true, maxRetries: 5 })
  })

  const report = (payload: object) =>
    app().inject({
      method: 'PUT',
      url: `/api/media/${videoId()}/progress`,
      payload,
      headers: asViewer,
    })

  it('lists a direct play with its browser, device, address, progress and audio track', async () => {
    expect(await admin().listLiveStreams()).toEqual([])
    expect((await play()).statusCode).toBe(206)
    expect((await report({ position: 3.5, audio: 0 })).statusCode).toBe(204)

    expect(await admin().listLiveStreams()).toEqual([
      expect.objectContaining({
        media: expect.objectContaining({ id: videoId() }),
        libraryName: 'Films',
        mode: PLAYBACK_MODES.direct,
        browser: 'Chrome 141',
        device: 'Mac',
        address: ADDRESS,
        position: 3.5,
        viewer: null,
        audio: 0,
        quality: null,
      }),
    ])
  })

  it('keeps the audio track through an older player’s report, which names none', async () => {
    expect((await report({ position: 4 })).statusCode).toBe(204)
    expect(await admin().listLiveStreams()).toEqual([
      expect.objectContaining({ position: 4, audio: 0 }),
    ])
  })

  it('keeps the position of a report whose audio is no track index, and ignores the audio', async () => {
    expect((await report({ position: 4.5, audio: -1 })).statusCode).toBe(204)
    expect(await admin().listLiveStreams()).toEqual([
      expect.objectContaining({ position: 4.5, audio: 0 }),
    ])
  })

  it('is for the admin alone', async () => {
    const [stream] = await admin().listLiveStreams()
    await expect(viewer().listLiveStreams()).rejects.toMatchObject({ status: 403 })
    await expect(viewer().stopStream(stream?.id ?? '')).rejects.toMatchObject({ status: 403 })
    expect(await admin().listLiveStreams()).toHaveLength(1)
  })

  it('stops a stream, and has nothing to stop the second time', async () => {
    const [stream] = await admin().listLiveStreams()
    await admin().stopStream(stream?.id ?? '')
    expect(await admin().listLiveStreams()).toEqual([])
    await expect(admin().stopStream(stream?.id ?? '')).rejects.toMatchObject({ status: 404 })
  })

  it('lists the stream again once the player asks again', async () => {
    await play()
    expect(await admin().listLiveStreams()).toHaveLength(1)
  })

  it('shows the folders of a library only with the admin lock off', async () => {
    expect((await admin().listLibraries()).map(({ paths }) => paths)).toEqual([[state.media]])
    const [shown] = await admin().listLibraries()
    expect(await admin().getLibrary(shown?.id ?? -1)).toMatchObject({ paths: [state.media] })

    expect((await viewer().listLibraries()).map(({ paths, layouts }) => [paths, layouts])).toEqual([
      [[], []],
    ])
    expect(await viewer().getLibrary(shown?.id ?? -1)).toMatchObject({ paths: [], layouts: [] })
    const pinned = await viewer().setLibraryView({
      id: shown?.id ?? -1,
      change: { pinned: true },
    })
    expect(pinned).toMatchObject({ paths: [], layouts: [] })
  })
})
