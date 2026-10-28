import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { NestFastifyApplication } from '@nestjs/platform-fastify'
import type { ApiClient } from '@raven/core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createApp } from '@/app'
import { adminCookie, injectAs, testConfig } from '@/test/app'
import { apiFor } from '@/test/server'

/** As a browser with the admin lock off, the only one that can change them. */
describe('playback settings', () => {
  const state: { root: string; admin: string; app: NestFastifyApplication | null } = {
    root: '',
    admin: '',
    app: null,
  }
  const app = (): NestFastifyApplication => {
    if (!state.app) throw new Error('app not started')
    return state.app
  }
  const api = (): ApiClient => apiFor({ app: app(), cookie: state.admin })
  type PutProps = { url: string; payload: Record<string, unknown> }

  /** A change by hand, for a value the client's types will not let it send. */
  const put = ({ url, payload }: PutProps) =>
    injectAs({ app: app(), cookie: state.admin })({ method: 'PUT', url, payload })
  const read = () => api().getPlaybackSettings()

  beforeAll(async () => {
    state.root = await mkdtemp(join(tmpdir(), 'raven-settings-'))
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

  it('starts on the defaults, with what they come to here', async () => {
    const initial = await read()
    expect(initial.settings).toEqual({
      directPlay: 'auto',
      transcoding: 'on',
      maxHeight: 1080,
      quality: 'medium',
      hwAccel: 'auto',
      tonemap: true,
      detectMarkers: true,
    })
    expect(initial.effective.encoder).toBe('software')
    expect(typeof initial.effective.tonemapAvailable).toBe('boolean')
  })

  it('changes the fields sent, keeps the rest, and refuses a value a setting does not take', async () => {
    const changed = await api().setPlaybackSettings({
      transcoding: 'remuxOnly',
      quality: 'high',
      hwAccel: 'none',
    })
    expect(changed.settings).toEqual((await read()).settings)
    expect((await read()).settings).toMatchObject({
      transcoding: 'remuxOnly',
      quality: 'high',
      hwAccel: 'none',
      maxHeight: 1080,
    })
    const refused = await put({ url: '/api/settings/playback', payload: { maxHeight: 480 } })
    expect(refused.statusCode).toBe(400)
    const unknown = await put({ url: '/api/settings/playback', payload: { bitrate: '8M' } })
    expect(unknown.statusCode).toBe(400)
    expect((await read()).settings.maxHeight).toBe(1080)
  })

  it('shows movie titles as logos until told to spell them out, and refuses another value', async () => {
    expect(await api().getDisplaySettings()).toEqual({ titles: 'logo' })
    expect(await api().setDisplaySettings({ titles: 'text' })).toEqual({ titles: 'text' })
    expect(await api().getDisplaySettings()).toEqual({ titles: 'text' })
    const refused = await put({ url: '/api/settings/display', payload: { titles: 'art' } })
    expect(refused.statusCode).toBe(400)
    expect(await api().getDisplaySettings()).toEqual({ titles: 'text' })
  })
})
