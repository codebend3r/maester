import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { NestFastifyApplication } from '@nestjs/platform-fastify'
import { AUTH_HEADERS, AUTH_PATHS, isAuthConfig, isServerHealth, isServerId } from '@raven/core'
import { CONTENT_TYPES, HEADERS, HTTP_METHODS, HTTP_STATUSES } from '@shared/server'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createApp } from '@/app'
import type { ServerConfig } from '@/config'
import { ServerEvents } from '@/events/serverEvents'
import { CORS_FLAGS, CORS_HEADERS, VARIES } from '@/cors'
import { AUTH_TEST_CONFIG, authFixture, bearerHeaders } from '@/test/auth'
import { NOT_WATCHING, testConfig } from '@/test/app'
import { ROUTES } from '@/test/enforced'

const NETLIFY = 'https://raven-player.netlify.app'
const FOREIGN = 'https://evil.example'

type AppProps = { dataDir: string; mediaDir: string }

const configFor = ({ dataDir, mediaDir }: AppProps): ServerConfig => {
  const base = testConfig({ dataDir, mediaDir })
  return {
    ...base,
    auth: AUTH_TEST_CONFIG,
    mediaPlane: {
      ...base.mediaPlane,
      webOrigins: [NETLIFY, 'https://deploy-preview-*--raven-player.netlify.app'],
    },
  }
}

/** What the suite starts once and reads in every test. */
type CorsSuiteState = {
  root: string
  app: NestFastifyApplication | null
  fixture: Awaited<ReturnType<typeof authFixture>> | null
  base: string
}

const accessControlOf = (headers: Record<string, unknown>): string[] =>
  Object.keys(headers).filter((name) => name.startsWith('access-control'))

describe('the JSON API across origins', () => {
  const state: CorsSuiteState = { root: '', app: null, fixture: null, base: '' }
  const app = (): NestFastifyApplication => {
    if (!state.app) throw new Error('app not started')
    return state.app
  }
  const fixture = () => {
    if (!state.fixture) throw new Error('fixture not made')
    return state.fixture
  }

  beforeAll(async () => {
    state.root = await mkdtemp(join(tmpdir(), 'raven-api-cors-'))
    state.fixture = await authFixture()
    state.app = await createApp({
      config: configFor({ dataDir: join(state.root, 'data'), mediaDir: state.root }),
      authKeys: state.fixture.keys,
      authFetch: state.fixture.fetcher,
      quiet: true,
      watch: NOT_WATCHING,
    })
    await state.app.init()
    await state.app.listen({ port: 0, host: '127.0.0.1' })
    state.base = await state.app.getUrl()
  })

  afterAll(async () => {
    app().getHttpAdapter().getInstance().server.closeAllConnections()
    await app().close()
    await rm(state.root, { recursive: true, force: true, maxRetries: 5 })
  })

  type PreflightProps = { url: string; origin?: string; privateNetwork?: boolean }

  const preflight = ({ url, origin = NETLIFY, privateNetwork = false }: PreflightProps) =>
    app().inject({
      method: HTTP_METHODS.options,
      url,
      headers: {
        [CORS_HEADERS.origin]: origin,
        [CORS_HEADERS.requestMethod]: HTTP_METHODS.put,
        ...(privateNetwork ? { [CORS_HEADERS.requestPrivateNetwork]: CORS_FLAGS.true } : {}),
      },
    })

  it('answers the preflight for a web origin: the Bearer and a JSON body, the API methods, never credentials', async () => {
    const response = await preflight({ url: ROUTES.libraries.path, privateNetwork: true })
    expect(response.statusCode).toBe(HTTP_STATUSES.noContent)
    expect(response.headers).toMatchObject({
      [CORS_HEADERS.allowOrigin]: NETLIFY,
      [HEADERS.vary]: VARIES.origin,
      [CORS_HEADERS.allowMethods]: [
        HTTP_METHODS.get,
        HTTP_METHODS.head,
        HTTP_METHODS.post,
        HTTP_METHODS.put,
        HTTP_METHODS.delete,
      ].join(', '),
      [CORS_HEADERS.allowHeaders]: `${HEADERS.authorization}, ${HEADERS.contentType}`,
      [CORS_HEADERS.maxAge]: '600',
      [CORS_HEADERS.allowPrivateNetwork]: CORS_FLAGS.true,
    })
    expect(response.headers[CORS_HEADERS.allowCredentials]).toBeUndefined()
    const preview = await preflight({
      url: ROUTES.libraries.path,
      origin: 'https://deploy-preview-7--raven-player.netlify.app',
    })
    expect(preview.headers[CORS_HEADERS.allowOrigin]).toBe(
      'https://deploy-preview-7--raven-player.netlify.app',
    )
    expect(preview.headers[CORS_HEADERS.allowPrivateNetwork]).toBeUndefined()
  })

  it('gives a foreign origin no CORS headers, on the preflight or the call', async () => {
    const refused = await preflight({ url: ROUTES.libraries.path, origin: FOREIGN })
    expect(refused.statusCode).toBe(HTTP_STATUSES.notFound)
    expect(accessControlOf(refused.headers)).toEqual([])
    const call = await app().inject({
      url: ROUTES.health.path,
      headers: { [CORS_HEADERS.origin]: FOREIGN },
    })
    expect(call.statusCode).toBe(HTTP_STATUSES.ok)
    expect(accessControlOf(call.headers)).toEqual([])
  })

  it('leaves a same-origin call without CORS headers', async () => {
    const response = await app().inject({ url: ROUTES.health.path })
    expect(accessControlOf(response.headers)).toEqual([])
  })

  it('answers a Bearer call from a web origin with the origin, and a refusal too', async () => {
    const token = await fixture().mint()
    const allowed = await app().inject({
      url: ROUTES.libraries.path,
      headers: { [CORS_HEADERS.origin]: NETLIFY, ...bearerHeaders({ token }) },
    })
    expect(allowed.statusCode).toBe(HTTP_STATUSES.ok)
    expect(allowed.headers[CORS_HEADERS.allowOrigin]).toBe(NETLIFY)
    expect(allowed.headers[CORS_HEADERS.allowCredentials]).toBeUndefined()
    const vary = String(allowed.headers[HEADERS.vary])
      .split(',')
      .map((name) => name.trim().toLowerCase())
    expect(vary).toContain(CORS_HEADERS.origin)
    expect(vary).toContain(AUTH_HEADERS.authorization)
    expect(vary.filter((name) => name === CORS_HEADERS.origin)).toHaveLength(1)
    const refused = await app().inject({
      url: ROUTES.libraries.path,
      headers: { [CORS_HEADERS.origin]: NETLIFY },
    })
    expect(refused.statusCode).toBe(HTTP_STATUSES.unauthorized)
    expect(refused.headers[CORS_HEADERS.allowOrigin]).toBe(NETLIFY)
  })

  it('opens the event stream across origins with a Bearer, CORS headers on its head', async () => {
    const token = await fixture().mint()
    const aborter = new AbortController()
    try {
      const response = await fetch(`${state.base}${ROUTES.events.path}`, {
        headers: { [CORS_HEADERS.origin]: NETLIFY, ...bearerHeaders({ token }) },
        signal: aborter.signal,
      })
      expect(response.status).toBe(HTTP_STATUSES.ok)
      expect(response.headers.get(HEADERS.contentType)).toContain(CONTENT_TYPES.eventStream)
      expect(response.headers.get(CORS_HEADERS.allowOrigin)).toBe(NETLIFY)
      expect(response.headers.get(HEADERS.vary)).toContain(VARIES.origin)
      expect(response.headers.get(CORS_HEADERS.allowCredentials)).toBeNull()
      const reader = response.body?.getReader()
      if (!reader) throw new Error('no body to read')
      app().get(ServerEvents).libraryChanged(42)
      type ReadUntilProps = { text: string; read: string }

      const readUntil = async ({ text, read }: ReadUntilProps): Promise<string> => {
        if (read.includes(text)) return read
        const chunk = await reader.read()
        if (chunk.done) throw new Error(`the stream ended before "${text}": ${read}`)
        return readUntil({ text, read: read + new TextDecoder().decode(chunk.value) })
      }
      expect(await readUntil({ text: '"libraryId":42', read: '' })).toContain('"libraryId":42')
    } finally {
      aborter.abort()
    }
  })

  it('answers the same server id, a uuid, on the health check and the auth config', async () => {
    const health: unknown = (await app().inject({ url: ROUTES.health.path })).json()
    const config: unknown = (await app().inject({ url: AUTH_PATHS.config })).json()
    if (!isServerHealth(health) || !isAuthConfig(config)) throw new Error('not understood')
    expect(isServerId(health.serverId)).toBe(true)
    expect(config.serverId).toBe(health.serverId)
  })
})

describe('the server id', () => {
  it('is made once and kept across restarts', async () => {
    const root = await mkdtemp(join(tmpdir(), 'raven-server-id-'))
    const fixture = await authFixture()
    const start = async (): Promise<NestFastifyApplication> => {
      const started = await createApp({
        config: configFor({ dataDir: join(root, 'data'), mediaDir: root }),
        authKeys: fixture.keys,
        authFetch: fixture.fetcher,
        quiet: true,
        watch: NOT_WATCHING,
      })
      await started.init()
      return started
    }
    const idOf = async (started: NestFastifyApplication): Promise<unknown> => {
      const health: unknown = (await started.inject({ url: ROUTES.health.path })).json()
      return isServerHealth(health) ? health.serverId : null
    }
    try {
      const first = await start()
      const id = await idOf(first)
      expect(await idOf(first)).toBe(id)
      await first.close()
      const second = await start()
      expect(await idOf(second)).toBe(id)
      await second.close()
    } finally {
      await rm(root, { recursive: true, force: true, maxRetries: 5 })
    }
  })
})
