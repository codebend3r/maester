import { Logger } from '@nestjs/common'
import {
  AUTH_CONFIG_STATES,
  DEFAULT_REMOTE_ACCESS_SETTINGS,
  MEDIA_ORIGIN_KINDS,
  type RemoteAccessSettings,
} from '@raven/core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { readServerConfig, type ServerConfig } from '@/config'
import { MediaOriginsController } from '@/media/mediaOriginsController'
import { MEDIA_PLANE_ENV } from '@/media/mediaPlaneConfig'
import { MediaTickets } from '@/media/mediaTickets'
import { AUTH_TEST_CONFIG } from '@/test/auth'

const LAN = 'https://raven.lan.example.test'

/** A request from the home network, and one from the internet. */
const HOME = { ip: '192.168.50.20', headers: {} }
const AWAY = { ip: '198.51.100.20', headers: {} }

/** A server with media origins set and no media secret. */
const CONFIG: ServerConfig = readServerConfig({
  [MEDIA_PLANE_ENV.origins]: `${MEDIA_ORIGIN_KINDS.lan}:${LAN}`,
})

type Auth = ConstructorParameters<typeof MediaOriginsController>[2]

type ControllerProps = { auth: Auth; remote?: RemoteAccessSettings }

const controllerFor = ({ auth, remote = DEFAULT_REMOTE_ACCESS_SETTINGS }: ControllerProps) =>
  new MediaOriginsController(CONFIG, new MediaTickets(CONFIG), auth, {
    remoteAccess: () => remote,
  })

const warningsAt = (auth: Auth): string[] => {
  const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
  expect(controllerFor({ auth })).toBeInstanceOf(MediaOriginsController)
  return warn.mock.calls.map(([message]) => String(message))
}

const CONFIGURED: RemoteAccessSettings = {
  ...DEFAULT_REMOTE_ACCESS_SETTINGS,
  isEnabled: true,
  hostname: 'raven.example.synology.me',
  publicPort: 8443,
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

describe('the media origins listed', () => {
  it('lists the environment origins, then the public origin Remote Access names', () => {
    expect(controllerFor({ auth: AUTH_TEST_CONFIG, remote: CONFIGURED }).list(HOME)).toEqual({
      remote: { limit: null, isOutside: false },
      origins: [
        { kind: MEDIA_ORIGIN_KINDS.lan, url: LAN },
        { kind: MEDIA_ORIGIN_KINDS.public, url: 'https://raven.example.synology.me:8443' },
      ],
    })
  })

  it('adds no public origin while Remote Access is off or not configured', () => {
    const lanOnly = {
      origins: [{ kind: MEDIA_ORIGIN_KINDS.lan, url: LAN }],
      remote: { limit: null, isOutside: false },
    }
    expect(
      controllerFor({ auth: AUTH_TEST_CONFIG, remote: { ...CONFIGURED, isEnabled: false } }).list(
        HOME,
      ),
    ).toEqual(lanOnly)
    expect(
      controllerFor({ auth: AUTH_TEST_CONFIG, remote: { ...CONFIGURED, publicPort: null } }).list(
        HOME,
      ),
    ).toEqual(lanOnly)
  })

  it('does not list an origin twice when the environment names it already', () => {
    const remote = { ...CONFIGURED, hostname: 'raven.lan.example.test', publicPort: 443 }
    expect(controllerFor({ auth: AUTH_TEST_CONFIG, remote }).list(HOME).origins).toHaveLength(1)
  })

  it('offers none while no ticket can prove who asks', () => {
    expect(
      controllerFor({ auth: { state: AUTH_CONFIG_STATES.off }, remote: CONFIGURED }).list(HOME),
    ).toEqual({ origins: [], remote: { limit: null, isOutside: false } })
  })

  it('tells every viewer the remote limit, and whether they asked from outside', () => {
    const limited = { ...CONFIGURED, remoteLimit: 'high1080', uploadMbps: 5 } as const
    expect(controllerFor({ auth: AUTH_TEST_CONFIG, remote: limited }).list(AWAY).remote).toEqual({
      limit: 'high720',
      isOutside: true,
    })
    expect(controllerFor({ auth: AUTH_TEST_CONFIG, remote: limited }).list(HOME).remote).toEqual({
      limit: 'high720',
      isOutside: false,
    })
  })
})
