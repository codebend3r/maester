import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { NestFastifyApplication } from '@nestjs/platform-fastify'
import {
  ITEM_TYPES,
  isUpcoming,
  isUpcomingPage,
  UPCOMING_PARAMS,
  UPCOMING_PATH,
  UPCOMING_SHELF_PATH,
  UPCOMING_SHELVES,
  type UpcomingShelf,
  fillPath,
} from '@raven/core'
import { afterEach, describe, expect, it } from 'vitest'
import { createApp } from '@/app'
import type { MetadataFetch } from '@/metadata/tmdbClient'
import { testConfig } from '@/test/app'

/** TMDB's discover, answering each call with one dated title named after the route asked. */
const discover: MetadataFetch = async ({ url }) => {
  const { pathname, searchParams } = new URL(url)
  const isFirstPage = searchParams.get('page') === '1'
  return new Response(
    JSON.stringify({
      total_results: 1,
      results: isFirstPage
        ? [
            {
              id: 5,
              title: pathname,
              release_date: '2026-12-25',
              poster_path: '/soon.jpg',
              popularity: 4,
            },
          ]
        : [],
    }),
  )
}

const down: MetadataFetch = async () => new Response('', { status: 500 })

const shelfUrl = (shelf: UpcomingShelf | string): string =>
  fillPath({ path: UPCOMING_SHELF_PATH, params: { [UPCOMING_PARAMS.shelf]: shelf } })

type StartProps = { token: string | null; fetch: MetadataFetch }

describe('GET /api/upcoming', () => {
  const state: { root: string; app: NestFastifyApplication | null } = { root: '', app: null }

  const start = async ({ token, fetch }: StartProps): Promise<NestFastifyApplication> => {
    state.root = await mkdtemp(join(tmpdir(), 'raven-upcoming-'))
    const app = await createApp({
      config: {
        ...testConfig({ dataDir: join(state.root, 'data'), mediaDir: state.root }),
        tmdbApiToken: token,
      },
      quiet: true,
      metadataFetch: fetch,
    })
    state.app = app
    await app.init()
    await app.getHttpAdapter().getInstance().ready()
    return app
  }

  afterEach(async () => {
    await state.app?.close()
    state.app = null
    await rm(state.root, { recursive: true, force: true })
  })

  it("answers with TMDB's three shelves", async () => {
    const app = await start({ token: 'test-token', fetch: discover })
    const response = await app.inject({ method: 'GET', url: UPCOMING_PATH })
    expect(response.statusCode).toBe(200)
    const body: unknown = response.json()
    if (!isUpcoming(body)) throw new Error(`Unexpected body: ${response.payload}`)
    expect(body.movies).toMatchObject([{ type: ITEM_TYPES.movie, title: '/3/discover/movie' }])
    expect(body.shows).toMatchObject([{ type: ITEM_TYPES.show, title: '/3/discover/tv' }])
    expect(body.documentaries.map((each) => each.type)).toEqual([ITEM_TYPES.movie, ITEM_TYPES.show])
  })

  it('answers a shelf a page at a time, the documentaries of both kinds merged', async () => {
    const app = await start({ token: 'test-token', fetch: discover })
    const response = await app.inject({
      method: 'GET',
      url: shelfUrl(UPCOMING_SHELVES.documentaries),
    })
    expect(response.statusCode).toBe(200)
    const body: unknown = response.json()
    if (!isUpcomingPage(body)) throw new Error(`Unexpected body: ${response.payload}`)
    expect(body.titles.map((each) => each.type)).toEqual([ITEM_TYPES.movie, ITEM_TYPES.show])
    expect(body.next).toBeNull()
  })

  it('answers 404 for a shelf there is not, and 400 for a cursor that is none', async () => {
    const app = await start({ token: 'test-token', fetch: discover })
    expect((await app.inject({ method: 'GET', url: shelfUrl('trailers') })).statusCode).toBe(404)
    const bad = await app.inject({
      method: 'GET',
      url: `${shelfUrl(UPCOMING_SHELVES.movies)}?${UPCOMING_PARAMS.after}=soon`,
    })
    expect(bad.statusCode).toBe(400)
  })

  it('answers 503 for a shelf with no TMDB token', async () => {
    const app = await start({ token: null, fetch: discover })
    const response = await app.inject({ method: 'GET', url: shelfUrl(UPCOMING_SHELVES.shows) })
    expect(response.statusCode).toBe(503)
  })

  it('answers 503 with no TMDB token', async () => {
    const app = await start({ token: null, fetch: discover })
    const response = await app.inject({ method: 'GET', url: UPCOMING_PATH })
    expect(response.statusCode).toBe(503)
    expect(response.json()).toMatchObject({
      message: 'Set TMDB_API_TOKEN to see what is coming soon.',
    })
  })

  it('answers 503 when TMDB fails', async () => {
    const app = await start({ token: 'test-token', fetch: down })
    const response = await app.inject({ method: 'GET', url: UPCOMING_PATH })
    expect(response.statusCode).toBe(503)
  })
})
