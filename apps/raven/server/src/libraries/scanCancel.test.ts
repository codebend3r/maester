import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { NestFastifyApplication } from '@nestjs/platform-fastify'
import { SCAN_STATES, isLibrary } from '@raven/core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createApp } from '@/app'
import { ScannerService } from '@/scanner/scannerService'
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
      config: testConfig({ dataDir: join(state.root, 'data'), mediaDir: state.root }),
      quiet: true,
    })
    await state.app.init()
    await state.app.getHttpAdapter().getInstance().ready()
    state.admin = await adminCookie(state.app)
  })

  afterAll(async () => {
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
