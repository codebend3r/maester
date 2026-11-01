import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { NestFastifyApplication } from '@nestjs/platform-fastify'
import { SCAN_STATES, isLibrary } from '@raven/core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createApp } from '@/app'
import { ScannerService } from '@/scanner/scannerService'
import { ScanControl } from '@/scanner/scanControl'
import { MarkerDetection } from '@/markers/markerDetection'
import { MarkerJobs } from '@/markers/markerJobs'
import { MetadataService } from '@/metadata/metadataService'
import { ThumbnailService } from '@/thumbnails/thumbnailService'
import { adminCookie, injectAs, testConfig } from '@/test/app'
import { encodeClip } from '@/test/clips'

describe('cancelling a scan', () => {
  const state: { root: string; admin: string; app: NestFastifyApplication | null } = {
    root: '',
    admin: '',
    app: null,
  }
  const app = (): NestFastifyApplication => {
    if (!state.app) throw new Error('app not started')
    return state.app
  }
  const asAdmin = injectAs

  beforeAll(async () => {
    state.root = await mkdtemp(join(tmpdir(), 'raven-cancel-'))
    await Promise.all(
      ['One', 'Two', 'Three'].map((name) =>
        encodeClip({ path: join(state.root, 'Clips', `${name}.mp4`), seconds: 1 }),
      ),
    )
    state.app = await createApp({
      config: {
        ...testConfig({ dataDir: join(state.root, 'data'), mediaDir: state.root }),
        markerDetection: true,
      },
      quiet: true,
    })
    await state.app.init()
    await state.app.getHttpAdapter().getInstance().ready()
    state.admin = await adminCookie(state.app)
  })

  afterAll(async () => {
    // A cancelled scan's thumbnails may still be writing into the data folder.
    await state.app?.get(ThumbnailService).whenIdle()
    await state.app?.close()
    await rm(state.root, { recursive: true, force: true })
  })

  it('stops a scan with no error, and leaves the library able to scan again', async () => {
    const send = asAdmin({ app: app(), cookie: state.admin })
    const created = await send({
      method: 'POST',
      url: '/api/libraries',
      payload: { name: 'Clips', paths: [join(state.root, 'Clips')], settings: { kind: 'other' } },
    })
    const id = created.json().id
    expect(typeof id).toBe('number')

    const cancelled = await send({ method: 'POST', url: `/api/libraries/${id}/scan/cancel` })
    expect(cancelled.statusCode).toBe(200)
    await app().get(ScannerService).whenIdle(id)

    const library = await send({ method: 'GET', url: `/api/libraries/${id}` })
    const body: unknown = library.json()
    if (!isLibrary(body)) throw new Error(`Unexpected body: ${library.rawPayload.toString()}`)
    expect(body.scan.state).toBe(SCAN_STATES.idle)
    expect(body.scan.error).toBeNull()

    await send({ method: 'POST', url: `/api/libraries/${id}/scan` })
    await app().get(ScannerService).whenIdle(id)
    const again = await send({ method: 'GET', url: `/api/libraries/${id}` })
    expect(again.json().itemCount).toBe(3)
  })

  it('stops a quick scan and the ratings that would follow it, and the library can scan again', async () => {
    const send = asAdmin({ app: app(), cookie: state.admin })
    const created = await send({
      method: 'POST',
      url: '/api/libraries',
      payload: { name: 'Quick', paths: [join(state.root, 'Clips')], settings: { kind: 'other' } },
    })
    const id = created.json().id
    await app().get(ScannerService).whenIdle(id)

    const started = await send({ method: 'POST', url: `/api/libraries/${id}/quick-scan` })
    expect(started.json().scan).toMatchObject({ kind: 'quick' })
    const cancelled = await send({ method: 'POST', url: `/api/libraries/${id}/quick-scan/cancel` })
    expect(cancelled.statusCode).toBe(200)
    await app().get(ScannerService).whenIdle(id)

    const library = await send({ method: 'GET', url: `/api/libraries/${id}` })
    expect(library.json().scan.state).toBe(SCAN_STATES.idle)
    expect(library.json().scan.error).toBeNull()
    expect(library.json().ratingsRefresh.state).toBe('idle')
    await send({ method: 'POST', url: `/api/libraries/${id}/quick-scan` })
    await app().get(ScannerService).whenIdle(id)
    expect((await send({ method: 'GET', url: `/api/libraries/${id}` })).json().itemCount).toBe(3)
  })

  it('stops every library and blocks watchers and marker work until allowed again', async () => {
    const send = asAdmin({ app: app(), cookie: state.admin })
    const created = await send({
      method: 'POST',
      url: '/api/libraries',
      payload: {
        name: 'Global stop',
        paths: [join(state.root, 'Clips')],
        settings: { kind: 'other' },
      },
    })
    const id = created.json().id
    const stopped = await send({
      method: 'PUT',
      url: '/api/admin/scans',
      payload: { isStopped: true },
    })
    expect(stopped.statusCode).toBe(200)
    expect(stopped.json()).toEqual({ isStopped: true })
    expect(app().get(ScanControl).signal.aborted).toBe(true)
    const scanner = app().get(ScannerService)
    await scanner.whenIdle(id)
    scanner.checkForChanges(id)
    scanner.quickScan(id)
    expect(scanner.status(id).state).toBe(SCAN_STATES.idle)
    expect(app().get(MarkerDetection).scanLibrary(id)).toBe(false)
    app().get(MetadataService).enqueue(id)
    await app().get(MetadataService).whenIdle()
    expect((await send({ method: 'GET', url: '/api/admin/scans' })).json()).toEqual({
      isStopped: true,
    })
    expect(
      (await send({ method: 'PUT', url: '/api/admin/scans', payload: { isStopped: 'yes' } }))
        .statusCode,
    ).toBe(400)
    expect(
      (await send({ method: 'PUT', url: '/api/admin/scans', payload: { isStopped: false } }))
        .statusCode,
    ).toBe(200)
    expect(app().get(ScanControl).signal.aborted).toBe(false)
    scanner.scan(id)
    await scanner.whenIdle(id)
    expect((await send({ method: 'GET', url: `/api/libraries/${id}` })).json().itemCount).toBe(3)
  })

  it('queues intros and credits for just the requested library, behind admin permission', async () => {
    const send = asAdmin({ app: app(), cookie: state.admin })
    const jobs = app().get(MarkerJobs)
    // This library has no matched video, so the request has no detection work to wait on.
    const response = await send({ method: 'POST', url: '/api/libraries/1/markers' })
    expect(response.statusCode).toBe(200)
    await app().get(MarkerDetection).whenIdle()
    expect(jobs.seasonsDue(99999)).toEqual([])
    expect(jobs.filmsDue(99999)).toEqual([])
    expect((await send({ method: 'POST', url: '/api/libraries/99999/markers' })).statusCode).toBe(
      404,
    )
    expect(
      (await app().inject({ method: 'POST', url: '/api/libraries/1/markers' })).statusCode,
    ).toBe(403)
    expect(
      (await app().inject({ method: 'PUT', url: '/api/admin/scans', payload: { isStopped: true } }))
        .statusCode,
    ).toBe(403)
    expect((await app().inject({ method: 'GET', url: '/api/admin/scans' })).statusCode).toBe(403)
  })

  it('is for the admin alone, and for a library that exists', async () => {
    expect(
      (await app().inject({ method: 'POST', url: '/api/libraries/1/scan/cancel' })).statusCode,
    ).toBe(403)
    expect(
      (
        await asAdmin({ app: app(), cookie: state.admin })({
          method: 'POST',
          url: '/api/libraries/999/refresh/cancel',
        })
      ).statusCode,
    ).toBe(404)
  })
})
