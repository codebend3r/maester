import { Logger } from '@nestjs/common'
import { AUTH_CONFIG_STATES, MEDIA_ORIGIN_KINDS } from '@raven/core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { readServerConfig, type ServerConfig } from '@/config'
import { MediaOriginsController } from '@/media/mediaOriginsController'
import { MEDIA_PLANE_ENV } from '@/media/mediaPlaneConfig'
import { MediaTickets } from '@/media/mediaTickets'
import { AUTH_TEST_CONFIG } from '@/test/auth'

/** A server with media origins set and no media secret. */
const CONFIG: ServerConfig = readServerConfig({
  [MEDIA_PLANE_ENV.origins]: `${MEDIA_ORIGIN_KINDS.lan}:https://raven.lan.example.test`,
})

const warningsAt = (auth: ConstructorParameters<typeof MediaOriginsController>[2]): string[] => {
  const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
  const controller = new MediaOriginsController(CONFIG, new MediaTickets(CONFIG), auth)
  expect(controller).toBeInstanceOf(MediaOriginsController)
  return warn.mock.calls.map(([message]) => String(message))
}

describe('the media origins boot log', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('names the missing secret while accounts are off', () => {
    const warnings = warningsAt({ state: AUTH_CONFIG_STATES.off })
    expect(warnings.some((warning) => warning.includes(MEDIA_PLANE_ENV.secret))).toBe(true)
  })

  it('says nothing of the secret once accounts are ready, which need none', () => {
    expect(warningsAt(AUTH_TEST_CONFIG)).toEqual([])
  })
})
