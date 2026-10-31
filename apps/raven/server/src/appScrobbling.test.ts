import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Logger, type LoggerService } from '@nestjs/common'
import type { NestFastifyApplication } from '@nestjs/platform-fastify'
import {
  type ApiClient,
  SCROBBLE_RETURNS,
  SCROBBLE_SERVICES,
  SCROBBLING_PATHS,
  createApiClient,
} from '@raven/core'
import { CACHE_POLICIES, HEADERS } from '@shared/server'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { createApp } from '@/app'
import type { MetadataFetch } from '@/metadata/tmdbClient'
import { LISTENBRAINZ_API } from '@/music/listenBrainzClient'
import { ScrobbleSender } from '@/scrobbling/scrobbleSender'
import { DatabaseService } from '@/db/database'
import { NOT_WATCHING, ROUTE_METHODS, testConfig } from '@/test/app'
import { AUTH_TEST_CONFIG, AUTH_TEST_IDS, authFixture, bearerHeaders } from '@/test/auth'
import { type MusicIds, addMusic, createEnforcedApp } from '@/test/enforced'
import { FAKE_LASTFM_KEYS, fakeLastFm } from '@/test/fakeLastFm'
import { fakeListenBrainz } from '@/test/fakeListenBrainz'
import { apiFor, injectFetch } from '@/test/server'

const LB_TOKENS = { member: 'lb-member-token-0001', local: 'lb-local-token-0001' } as const

const FM_TOKENS = { member: 'fm-member-token-0001', unknown: 'fm-unknown-token-0001' } as const

const WEB_RETURN = `${AUTH_TEST_CONFIG.webUrl}${SCROBBLE_RETURNS.web}`

/** Every line any logger or the console was handed while this file ran. */
const logged: string[] = []

const heard = (...parts: unknown[]): void => {
  logged.push(
    parts.map((part) => (typeof part === 'string' ? part : JSON.stringify(part))).join(' '),
  )
}

const SPY_LOGGER: LoggerService = {
  log: heard,
  error: heard,
  warn: heard,
  debug: heard,
  verbose: heard,
  fatal: heard,
}

/** Every secret this file hands a fake or the server, which no log line may hold. */
const secrets = new Set<string>([
  ...Object.values(LB_TOKENS),
  ...Object.values(FM_TOKENS),
  `session-of-${FM_TOKENS.member}`,
])

const listenBrainz = fakeListenBrainz({
  users: { [LB_TOKENS.member]: 'member-lb', [LB_TOKENS.local]: 'local-lb' },
})

const lastFm = fakeLastFm({ tokens: { [FM_TOKENS.member]: 'member-fm' } })

const scrobbleFetch: MetadataFetch = (request) =>
  request.url.startsWith(LISTENBRAINZ_API) ? listenBrainz.fetch(request) : lastFm.fetch(request)

let root: string

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'raven-scrobbling-'))
  ;(['log', 'error', 'warn', 'info', 'debug'] as const).forEach((method) =>
    vi.spyOn(console, method).mockImplementation(heard),
  )
})

afterAll(async () => {
  vi.restoreAllMocks()
  await rm(root, { recursive: true, force: true, maxRetries: 5 })
  expect(logged.some((line) => line.includes('refused'))).toBe(true)
  expect(logged.filter((line) => [...secrets].some((secret) => line.includes(secret)))).toEqual([])
})

/** The stored link rows, as SQLite holds them. */
const storedLinks = (app: NestFastifyApplication) =>
  app.get(DatabaseService).db.prepare('SELECT * FROM scrobble_links').all()

describe('scrobbling on a server without accounts', () => {
  const state: { app: NestFastifyApplication | null } = { app: null }
  const app = (): NestFastifyApplication => {
    if (!state.app) throw new Error('app not started')
    return state.app
  }
  const api = (): ApiClient => apiFor({ app: app() })

  beforeAll(async () => {
    state.app = await createApp({
      config: testConfig({ dataDir: join(root, 'off'), mediaDir: root }),
      quiet: true,
      watch: NOT_WATCHING,
      metadataFetch: scrobbleFetch,
    })
    await state.app.init()
    Logger.overrideLogger(SPY_LOGGER)
  })

  afterAll(() => state.app?.close())

  it('lists Last.fm as off without its keys, and refuses to start its sign-in', async () => {
    await expect(api().getScrobbling()).resolves.toEqual([
      { service: SCROBBLE_SERVICES.listenBrainz, isAvailable: true, username: null },
      { service: SCROBBLE_SERVICES.lastFm, isAvailable: false, username: null },
    ])
    await expect(api().startLastFm({ returnTo: SCROBBLE_RETURNS.wren })).rejects.toMatchObject({
      status: 409,
    })
  })

  it('refuses a token ListenBrainz does not know, storing nothing, and links the local account with one it does', async () => {
    await expect(api().linkListenBrainz({ token: 'not-a-known-token' })).rejects.toMatchObject({
      status: 400,
    })
    secrets.add('not-a-known-token')
    expect(storedLinks(app())).toEqual([])

    const linked = await api().linkListenBrainz({ token: LB_TOKENS.local })
    expect(linked).toContainEqual({
      service: SCROBBLE_SERVICES.listenBrainz,
      isAvailable: true,
      username: 'local-lb',
    })
    expect(storedLinks(app())).toEqual([expect.objectContaining({ account_id: 'local' })])
    expect(JSON.stringify(storedLinks(app()))).not.toContain(LB_TOKENS.local)
  })

  it('answers ListenBrainz being away as a bad gateway', async () => {
    listenBrainz.setDown({ isDown: true })
    await expect(api().linkListenBrainz({ token: LB_TOKENS.local })).rejects.toMatchObject({
      status: 502,
    })
    listenBrainz.setDown({ isDown: false })
  })
})

describe('scrobbling on a server with accounts', () => {
  const state: {
    enforced: Awaited<ReturnType<typeof createEnforcedApp>> | null
    music: MusicIds | null
    fixture: Awaited<ReturnType<typeof authFixture>> | null
  } = { enforced: null, music: null, fixture: null }

  const enforced = () => {
    if (!state.enforced || !state.music || !state.fixture) throw new Error('app not started')
    return { ...state.enforced, music: state.music, fixture: state.fixture }
  }

  type ClientForProps = { id: string }

  const clientFor = async ({ id }: ClientForProps) => {
    const { app, fixture } = enforced()
    const token = await fixture.mint({ id })
    return createApiClient({ fetch: injectFetch({ app }), accessToken: () => token })
  }

  type CallbackProps = { token: string; state: string }

  /** Last.fm's page coming back, as the browser follows it: no session, no cookie. */
  const callback = ({ token, state: signed }: CallbackProps) =>
    enforced().app.inject({
      url: `${SCROBBLING_PATHS.lastFmCallback}?${new URLSearchParams({ token, state: signed }).toString()}`,
    })

  type StartedProps = { api: ApiClient; returnTo: string }

  /** The state Last.fm's page would hand back, read off the callback `start` named. */
  const started = async ({ api, returnTo }: StartedProps): Promise<string> => {
    const { url } = await api.startLastFm({ returnTo })
    const page = new URL(url)
    const cb = new URL(page.searchParams.get('cb') ?? '')
    expect(`${cb.origin}${cb.pathname}`).toBe(
      `${AUTH_TEST_CONFIG.webUrl}${SCROBBLING_PATHS.lastFmCallback}`,
    )
    expect(page.searchParams.get('api_key')).toBe(FAKE_LASTFM_KEYS.apiKey)
    const signed = cb.searchParams.get('state') ?? ''
    secrets.add(signed)
    return signed
  }

  beforeAll(async () => {
    state.fixture = await authFixture()
    state.enforced = await createEnforcedApp({
      root: join(root, 'enforced'),
      fixture: state.fixture,
      scrobbling: { fetch: scrobbleFetch, lastFm: FAKE_LASTFM_KEYS },
    })
    state.music = await addMusic({ root: join(root, 'enforced'), enforced: state.enforced })
    Logger.overrideLogger(SPY_LOGGER)
  })

  afterAll(() => state.enforced?.app.close())

  it('starts Last.fm only for a return address it knows exactly', async () => {
    const member = await clientFor({ id: AUTH_TEST_IDS.friend })
    const refused = await Promise.all(
      ['https://evil.example.test/settings', `${WEB_RETURN}/`, 'wren://scrobbling/x', ''].map(
        (returnTo) => member.startLastFm({ returnTo }).catch((error: unknown) => error),
      ),
    )
    expect(refused).toEqual(refused.map(() => expect.objectContaining({ status: 400 })))
    await expect(started({ api: member, returnTo: SCROBBLE_RETURNS.wren })).resolves.toMatch(
      /^[\w-]+\.[\w-]+$/u,
    )
  })

  it('links Last.fm through its callback once, going back to where it started, and refuses a replay', async () => {
    const member = await clientFor({ id: AUTH_TEST_IDS.friend })
    const signed = await started({ api: member, returnTo: WEB_RETURN })
    const answer = await callback({ token: FM_TOKENS.member, state: signed })
    expect(answer.statusCode).toBe(302)
    expect(answer.headers.location).toBe(`${WEB_RETURN}?scrobbling=linked`)
    expect(answer.headers[HEADERS.cacheControl]).toBe(CACHE_POLICIES.noStore)
    expect(await member.getScrobbling()).toContainEqual({
      service: SCROBBLE_SERVICES.lastFm,
      isAvailable: true,
      username: 'member-fm',
    })

    expect((await callback({ token: FM_TOKENS.member, state: signed })).statusCode).toBe(400)
    expect((await callback({ token: FM_TOKENS.member, state: `${signed}x` })).statusCode).toBe(400)

    const unknown = await started({ api: member, returnTo: SCROBBLE_RETURNS.wren })
    const failed = await callback({ token: FM_TOKENS.unknown, state: unknown })
    expect(failed.headers.location).toBe(`${SCROBBLE_RETURNS.wren}?scrobbling=failed`)
  })

  it("forwards a music track's play to each linked service, and a film's to none", async () => {
    const member = await clientFor({ id: AUTH_TEST_IDS.friend })
    await member.linkListenBrainz({ token: LB_TOKENS.member })
    const sender = enforced().app.get(ScrobbleSender)
    await sender.whenIdle()
    const before = { lb: listenBrainz.submissions.length, fm: lastFm.scrobbles.length }
    await member.recordPlay(enforced().ids.video)
    await sender.whenIdle()
    expect(listenBrainz.submissions).toHaveLength(before.lb)

    await member.recordPlay(enforced().music.tracks[0])
    await sender.whenIdle()
    expect(listenBrainz.submissions.slice(before.lb)).toEqual([
      expect.objectContaining({ token: LB_TOKENS.member }),
    ])
    expect(lastFm.scrobbles.slice(before.fm)).toEqual([
      expect.objectContaining({ track: 'Airbag', artist: 'Radiohead' }),
    ])
    const stored = JSON.stringify(storedLinks(enforced().app))
    expect([...secrets].filter((secret) => stored.includes(secret))).toEqual([])
  })

  it("shows another account nothing of the first's links, and unlinks only its own", async () => {
    const guest = await clientFor({ id: AUTH_TEST_IDS.guest })
    const member = await clientFor({ id: AUTH_TEST_IDS.friend })
    await expect(guest.getScrobbling()).resolves.toEqual([
      { service: SCROBBLE_SERVICES.listenBrainz, isAvailable: true, username: null },
      { service: SCROBBLE_SERVICES.lastFm, isAvailable: true, username: null },
    ])
    await guest.unlinkScrobbling({ service: SCROBBLE_SERVICES.lastFm })
    expect((await member.getScrobbling()).map(({ username }) => username)).toEqual([
      'member-lb',
      'member-fm',
    ])
    const unknown = await enforced().app.inject({
      method: ROUTE_METHODS.delete,
      url: `${SCROBBLING_PATHS.root}/spotify`,
      headers: bearerHeaders({ token: await enforced().fixture.mint({ id: AUTH_TEST_IDS.guest }) }),
    })
    expect(unknown.statusCode).toBe(404)
  })

  it('unlinks a service that refuses the account, and forgets what was waiting for it', async () => {
    const member = await clientFor({ id: AUTH_TEST_IDS.friend })
    const sender = enforced().app.get(ScrobbleSender)
    listenBrainz.setSubmitStatus({ status: 401 })
    await member.recordPlay(enforced().music.tracks[1])
    await sender.whenIdle()
    listenBrainz.setSubmitStatus({ status: null })
    expect((await member.getScrobbling()).map(({ username }) => username)).toEqual([
      null,
      'member-fm',
    ])
    await expect(
      member.unlinkScrobbling({ service: SCROBBLE_SERVICES.lastFm }),
    ).resolves.toContainEqual({
      service: SCROBBLE_SERVICES.lastFm,
      isAvailable: true,
      username: null,
    })
  })
})
