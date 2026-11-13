import { createHmac, randomBytes } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { NestFastifyApplication } from '@nestjs/platform-fastify'
import {
  DEFAULT_REMOTE_ACCESS_SETTINGS,
  HLS_PARAMS,
  HLS_PATHS,
  MEDIA_ORIGIN_KINDS,
  PLAYBACK_MODES,
  REACHABILITY_CHECK_PATH,
  REACHABILITY_PARAMS,
  REACHABILITY_PROBLEMS,
  REMOTE_ACCESS_PATHS,
  REMOTE_ACCESS_STATES,
  REMOTE_LIMITS,
  fromQueryString,
  toQueryString,
} from '@raven/core'
import { CACHE_POLICIES, HEADERS } from '@shared/server'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp } from '@/app'
import { AUTH_ENV } from '@/auth/authConfig'
import { MediaIndex } from '@/media/mediaIndex'
import { MEDIA_PLANE_ENV, readMediaPlaneConfig } from '@/media/mediaPlaneConfig'
import type { ReachabilityFetch } from '@/remoteAccess/reachability'
import { REMOTE_ACCESS_ENV, readRemoteAccessConfig } from '@/remoteAccess/remoteAccessConfig'
import { ScannerService } from '@/scanner/scannerService'
import { NOT_WATCHING, TRUSTED_PROXY, adminCookie, routePath, testConfig } from '@/test/app'
import { encodeClip } from '@/test/clips'
import { apiFor } from '@/test/server'

const SITE = 'https://raven-player.netlify.app'
const LAN = 'https://raven.home.example'
const HOSTNAME = 'raven.example.synology.me'
const PUBLIC_ORIGIN = `https://${HOSTNAME}:8443`

/** Where the outside check reaches raven from: Netlify, through the NAS's reverse proxy. */
const OUTSIDE = { remoteAddress: TRUSTED_PROXY, forwardedFor: '198.51.100.7' } as const

/** What raven signs each check with, as the reachability function's own variable holds it. */
const PROXY_SECRET = 'a-proxy-secret-of-at-least-32-characters'

/** The home network's address, as the outside check sees the call. */
const HOME_WAN = '203.0.113.9'

/** A viewer away from home, as the socket names them. */
const AWAY = '198.51.100.20'

type Started = { app: NestFastifyApplication; admin: string; video: number }

/** What the stand-in for the reachability function answers. */
const CHECK_ANSWERS = { reachable: 'reachable', notRaven: 'notRaven', broken: 'broken' } as const

type CheckAnswer = (typeof CHECK_ANSWERS)[keyof typeof CHECK_ANSWERS]

describe('Remote Access', () => {
  const state: { root: string; started: Started | null; answer: CheckAnswer } = {
    root: '',
    started: null,
    answer: CHECK_ANSWERS.reachable,
  }
  const started = (): Started => {
    if (!state.started) throw new Error('app not started')
    return state.started
  }

  /** The web app's reachability function: it fetches the echo as the outside world would. */
  const reachabilityFetch = vi.fn<ReachabilityFetch>(async ({ url }) => {
    if (state.answer === CHECK_ANSWERS.broken) throw new Error('fetch failed')
    const query = fromQueryString(url.slice(url.indexOf('?') + 1))
    const echo = await started().app.inject({
      method: 'GET',
      url: routePath({
        route: REMOTE_ACCESS_PATHS.echo,
        values: { nonce: query[REACHABILITY_PARAMS.nonce] ?? '' },
      }),
      remoteAddress: OUTSIDE.remoteAddress,
      headers: { [HEADERS.forwardedFor]: `10.0.0.5, ${OUTSIDE.forwardedFor}` },
    })
    const seen = { publicAddress: HOME_WAN, resolved: [HOME_WAN] }
    const report =
      echo.statusCode === 204 && state.answer === CHECK_ANSWERS.reachable
        ? { state: REMOTE_ACCESS_STATES.reachable, ...seen }
        : {
            state: REMOTE_ACCESS_STATES.unreachable,
            problem: REACHABILITY_PROBLEMS.notRaven,
            ...seen,
          }
    return Response.json(report)
  })

  beforeAll(async () => {
    state.root = await mkdtemp(join(tmpdir(), 'raven-remote-access-'))
    const media = join(state.root, 'media')
    await encodeClip({ path: join(media, 'Heat (1995).mp4'), seconds: 2 })
    const env = {
      [MEDIA_PLANE_ENV.origins]: `${MEDIA_ORIGIN_KINDS.lan}:${LAN}`,
      [MEDIA_PLANE_ENV.secret]: randomBytes(32).toString('base64'),
      [AUTH_ENV.webUrl]: SITE,
    }
    const app = await createApp({
      config: {
        ...testConfig({ dataDir: join(state.root, 'data'), mediaDir: state.root }),
        mediaPlane: readMediaPlaneConfig(env),
        remoteAccess: readRemoteAccessConfig({
          ...env,
          [REMOTE_ACCESS_ENV.trustedProxies]: TRUSTED_PROXY,
          [REMOTE_ACCESS_ENV.proxySecret]: PROXY_SECRET,
        }),
      },
      quiet: true,
      watch: NOT_WATCHING,
      reachabilityFetch,
    })
    await app.init()
    const admin = await adminCookie(app)
    const created = await apiFor({ app, cookie: admin }).createLibrary({
      name: 'Films',
      paths: [media],
    })
    await app.get(ScannerService).whenIdle(created.id)
    const [video] = app.get(MediaIndex).idsForLibrary(created.id)
    if (video == null) throw new Error('the clip was not scanned')
    state.started = { app, admin, video }
  })

  afterAll(async () => {
    await state.started?.app.close()
    await rm(state.root, { recursive: true, force: true, maxRetries: 5 })
  })

  beforeEach(() => {
    reachabilityFetch.mockClear()
    state.answer = CHECK_ANSWERS.reachable
  })

  const api = () => apiFor({ app: started().app, cookie: started().admin })

  it('starts off, naming the LAN address and no public origin, uncached and for the owner alone', async () => {
    const read = await started().app.inject({
      method: 'GET',
      url: REMOTE_ACCESS_PATHS.settings,
      headers: { cookie: started().admin },
    })
    expect(read.statusCode).toBe(200)
    expect(read.headers[HEADERS.cacheControl]).toBe(CACHE_POLICIES.noStore)
    expect(read.json()).toEqual({
      settings: DEFAULT_REMOTE_ACCESS_SETTINGS,
      privateAddress: 'raven.home.example',
      publicOrigin: null,
      status: { state: REMOTE_ACCESS_STATES.disabled },
    })
    const stranger = await started().app.inject({
      method: 'GET',
      url: REMOTE_ACCESS_PATHS.settings,
    })
    expect(stranger.statusCode).toBe(403)
    expect(reachabilityFetch).not.toHaveBeenCalled()
  })

  it('refuses a change that is not one the settings take', async () => {
    const bad = [{ hostname: '203.0.113.9' }, { publicPort: 70_000 }, { uploadMbps: -1 }, { x: 1 }]
    const statuses = await Promise.all(
      bad.map(
        async (payload) =>
          (
            await started().app.inject({
              method: 'PUT',
              url: REMOTE_ACCESS_PATHS.settings,
              headers: { cookie: started().admin },
              payload,
            })
          ).statusCode,
      ),
    )
    expect(statuses).toEqual([400, 400, 400, 400])
  })

  it('asks for a hostname and a port once enabled', async () => {
    const saved = await api().setRemoteAccess({ isEnabled: true })
    expect(saved.status).toEqual({ state: REMOTE_ACCESS_STATES.unconfigured })
    expect(saved.publicOrigin).toBeNull()
    expect(reachabilityFetch).not.toHaveBeenCalled()
  })

  it('checks from outside on Apply, through the site, and is fully accessible once the echo answers', async () => {
    const saved = await api().setRemoteAccess({ hostname: HOSTNAME, publicPort: 8443 })
    expect(saved.publicOrigin).toBe(PUBLIC_ORIGIN)
    expect(saved.status).toMatchObject({
      state: REMOTE_ACCESS_STATES.reachable,
      isClientAddressForwarded: true,
      publicAddress: HOME_WAN,
      resolved: [HOME_WAN],
    })
    expect(reachabilityFetch).toHaveBeenCalledTimes(1)
    const url = reachabilityFetch.mock.calls[0]?.[0].url ?? ''
    expect(url.startsWith(`${SITE}${REACHABILITY_CHECK_PATH}?`)).toBe(true)
    const query = fromQueryString(url.slice(url.indexOf('?') + 1))
    expect(query[REACHABILITY_PARAMS.host]).toBe(HOSTNAME)
    expect(query[REACHABILITY_PARAMS.port]).toBe('8443')
    const nonce = query[REACHABILITY_PARAMS.nonce] ?? ''
    expect(query[REACHABILITY_PARAMS.signature]).toBe(
      createHmac('sha256', PROXY_SECRET).update(nonce).digest('hex'),
    )
  })

  it("keeps a check's answer for a minute on reading, and checks again on an empty change", async () => {
    await api().getRemoteAccess()
    expect(reachabilityFetch).not.toHaveBeenCalled()
    await api().setRemoteAccess({})
    expect(reachabilityFetch).toHaveBeenCalledTimes(1)
  })

  it('answers the echo only while a check holds its nonce', async () => {
    const echo = await started().app.inject({
      method: 'GET',
      url: routePath({ route: REMOTE_ACCESS_PATHS.echo, values: { nonce: 'A'.repeat(22) } }),
    })
    expect(echo.statusCode).toBe(404)
  })

  it('says what went wrong when something else answers, or the check can not run', async () => {
    state.answer = CHECK_ANSWERS.notRaven
    expect((await api().setRemoteAccess({})).status).toMatchObject({
      state: REMOTE_ACCESS_STATES.unreachable,
      problem: REACHABILITY_PROBLEMS.notRaven,
    })
    state.answer = CHECK_ANSWERS.broken
    expect((await api().setRemoteAccess({})).status).toMatchObject({
      state: REMOTE_ACCESS_STATES.unreachable,
      problem: REACHABILITY_PROBLEMS.checkerFailed,
      publicAddress: null,
    })
  })

  it('lists the public origin among the media origins, after the LAN one', async () => {
    await expect(api().getMediaOrigins()).resolves.toEqual({
      origins: [
        { kind: MEDIA_ORIGIN_KINDS.lan, url: LAN },
        { kind: MEDIA_ORIGIN_KINDS.public, url: PUBLIC_ORIGIN },
      ],
      remote: { limit: null, isOutside: false },
    })
  })

  it('tells a viewer away from home the remote limit, so the player asks for a transcode at it', async () => {
    await api().setRemoteAccess({ remoteLimit: 'high1080', uploadMbps: 10 })
    const listed = await started().app.inject({
      method: 'GET',
      url: '/api/media-origins',
      remoteAddress: AWAY,
    })
    expect(listed.json().remote).toEqual({ limit: 'standard1080', isOutside: true })
    await api().setRemoteAccess({ remoteLimit: REMOTE_LIMITS.original, uploadMbps: null })
  })

  describe('the remote stream limit', () => {
    type BandwidthProps = { remoteAddress: string; quality?: string }

    const bandwidthOf = async ({ remoteAddress, quality }: BandwidthProps): Promise<number> => {
      const query = toQueryString({
        [HLS_PARAMS.mode]: PLAYBACK_MODES.transcode,
        ...(quality === undefined ? {} : { [HLS_PARAMS.quality]: quality }),
      })
      const master = await started().app.inject({
        method: 'GET',
        url: `${routePath({ route: HLS_PATHS.master, values: { id: started().video } })}?${query}`,
        remoteAddress,
      })
      expect(master.statusCode).toBe(200)
      return Number(/BANDWIDTH=(\d+)/.exec(master.body)?.[1] ?? Number.NaN)
    }

    it('holds a transcode for a viewer away from home to the limit, and leaves one at home be', async () => {
      await api().setRemoteAccess({ remoteLimit: 'low720', uploadMbps: null })
      // The server's own settings aim at 8 Mb/s, its medium quality.
      await expect(bandwidthOf({ remoteAddress: '127.0.0.1' })).resolves.toBe(8_000_000)
      await expect(bandwidthOf({ remoteAddress: '192.168.50.20' })).resolves.toBe(8_000_000)
      await expect(bandwidthOf({ remoteAddress: AWAY })).resolves.toBe(2_000_000)
      await expect(bandwidthOf({ remoteAddress: AWAY, quality: 'high1080' })).resolves.toBe(
        2_000_000,
      )
      await expect(bandwidthOf({ remoteAddress: AWAY, quality: 'sd480' })).resolves.toBe(1_500_000)
    })

    it('keeps one remote stream under the whole upload with no limit', async () => {
      await api().setRemoteAccess({ remoteLimit: REMOTE_LIMITS.original, uploadMbps: 5 })
      await expect(bandwidthOf({ remoteAddress: AWAY })).resolves.toBe(4_000_000)
      await api().setRemoteAccess({ uploadMbps: null })
      await expect(bandwidthOf({ remoteAddress: AWAY })).resolves.toBe(8_000_000)
    })
  })
})
