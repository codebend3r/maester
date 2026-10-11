import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { NestFastifyApplication } from '@nestjs/platform-fastify'
import type { ApiClient } from '@raven/core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createApp } from '@/app'
import { readServerConfig } from '@/config'
import { apiFor } from '@/test/server'

describe('playback settings', () => {
  const state: { root: string; app: NestFastifyApplication | null } = { root: '', app: null }
  const app = (): NestFastifyApplication => {
    if (!state.app) throw new Error('app not started')
    return state.app
  }
  const api = (): ApiClient => apiFor({ app: app() })
  const read = () => api().getPlaybackSettings()

  beforeAll(async () => {
    state.root = await mkdtemp(join(tmpdir(), 'raven-settings-'))
    state.app = await createApp({
      config: {
        ...readServerConfig({}),
        hwAccel: 'none',
        dataDir: join(state.root, 'data'),
        browseRoot: state.root,
        scanOnStart: false,
      },
      quiet: true,
    })
    await state.app.init()
    await state.app.getHttpAdapter().getInstance().ready()
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
    // Values the client's types will not let it send, so sent by hand.
    const refused = await app().inject({
      method: 'PUT',
      url: '/api/settings/playback',
      payload: { maxHeight: 480 },
    })
    expect(refused.statusCode).toBe(400)
    const unknown = await app().inject({
      method: 'PUT',
      url: '/api/settings/playback',
      payload: { bitrate: '8M' },
    })
    expect(unknown.statusCode).toBe(400)
    expect((await read()).settings.maxHeight).toBe(1080)
  })
})
