import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { NestFastifyApplication } from '@nestjs/platform-fastify'
import { isLibrary, isShowListing, type LibraryKind } from '@raven/core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createApp } from '@/app'
import { readServerConfig } from '@/config'
import { MetadataService } from '@/metadata/metadataService'
import { ScannerService } from '@/scanner/scannerService'
import { encodeClip } from '@/test/clips'
import { type FakeReply, fakeClaude } from '@/test/fakeClaude'
import { type FakeShow, fakeTmdb } from '@/test/fakeTmdb'
import { ThumbnailService } from '@/thumbnails/thumbnailService'

type Injected = { statusCode: number; rawPayload: Buffer; json: () => unknown }

const shape = <T>({
  response,
  guard,
}: {
  response: Injected
  guard: (value: unknown) => value is T
}): T => {
  const body: unknown = response.json()
  if (!guard(body)) throw new Error(`Unexpected body: ${response.rawPayload.toString()}`)
  return body
}

/** TMDB knows the show the misnamed folder is, and two shows called Archie something. */
const SHOWS: FakeShow[] = [
  {
    id: 80001,
    title: 'Wild Arctic',
    first: '2018-01-07',
    seasons: {
      1: [
        { number: 1, title: 'Polar Night', aired: '2018-01-07' },
        { number: 2, title: 'The Thaw', aired: '2018-01-14' },
      ],
    },
  },
  {
    id: 201000,
    title: 'Archie: The Man Who Became Cary Grant',
    first: '2023-12-07',
    seasons: { 1: [{ number: 1, title: 'Episode 1', aired: '2023-12-07' }] },
  },
  { id: 4321, title: 'The Archie Show', first: '1968-09-14', seasons: {} },
]

const WILD_REASON = "Season 1's episode titles match TMDB's (Polar Night, The Thaw)."
const ARCHIE_REASON = 'The only Archie series from 2023; its episode titles are generic.'

/** What Claude does for each group, as the spike saw it: sure, unsure, and nothing. */
const LOOKUPS: Record<string, readonly FakeReply[]> = {
  'Destination Wild Arctic': [
    { kind: 'search', type: 'show', query: 'Wild Arctic', year: null },
    { kind: 'episodes', tmdbId: '80001', season: 1 },
    { kind: 'choose', tmdbId: '80001', confidence: 'high', reason: WILD_REASON },
  ],
  Archie: [
    { kind: 'search', type: 'show', query: 'Archie', year: null },
    { kind: 'choose', tmdbId: '201000', confidence: 'low', reason: ARCHIE_REASON },
  ],
  'Cesar 911': [
    { kind: 'search', type: 'show', query: 'Cesar 911', year: null },
    {
      kind: 'choose',
      tmdbId: null,
      confidence: 'high',
      reason: 'The files are episodes of another show.',
    },
  ],
}

const WILD = [
  'Destination Wild Arctic/Season 1/Destination Wild Arctic - S01E01 - Polar Night.mp4',
  'Destination Wild Arctic/Season 1/Destination Wild Arctic - S01E02 - The Thaw.mp4',
]
const ARCHIE = 'Archie/Season 1/Archie - S01E01 - Episode 1.mp4'
const CESAR = 'Cesar 911/Season 1/Cesar 911 - S01E01 - Lilly.mp4'

/**
 * A server over a temp tree, answering for TMDB and Claude: `files` in a TV
 * shows library, and one video in an Other library beside it.
 */
const startServer = ({
  prefix,
  files,
  aiDailyLimit,
}: {
  prefix: string
  files: readonly string[]
  aiDailyLimit: number
}) => {
  const tmdb = fakeTmdb({ movies: [], shows: SHOWS })
  const claude = fakeClaude({ lookups: LOOKUPS })
  const state: {
    root: string
    app: NestFastifyApplication | null
    library: number
    clips: number
  } = { root: '', app: null, library: 0, clips: 0 }
  const app = (): NestFastifyApplication => {
    if (!state.app) throw new Error('app not started')
    return state.app
  }
  const settle = async () => {
    await app().get(ScannerService).whenIdle(state.library)
    await app().get(ScannerService).whenIdle(state.clips)
    await app().get(MetadataService).whenIdle()
    await app().get(ThumbnailService).whenIdle()
  }
  const get = async <T>({
    url,
    guard,
  }: {
    url: string
    guard: (value: unknown) => value is T
  }): Promise<T> => shape({ response: await app().inject({ method: 'GET', url }), guard })
  const create = async ({ name, path, kind }: { name: string; path: string; kind: LibraryKind }) =>
    shape({
      response: await app().inject({
        method: 'POST',
        url: '/api/libraries',
        payload: { name, paths: [path], settings: { kind } },
      }),
      guard: isLibrary,
    }).id
  const start = async () => {
    state.root = await mkdtemp(join(tmpdir(), prefix))
    await Promise.all(
      files.map((path) => encodeClip({ path: join(state.root, 'TV', path), seconds: 1 })),
    )
    await encodeClip({ path: join(state.root, 'Clips', 'Birthday Party.mp4'), seconds: 1 })
    state.app = await createApp({
      config: {
        ...readServerConfig({}),
        hwAccel: 'none',
        dataDir: join(state.root, 'data'),
        webDir: null,
        browseRoot: state.root,
        scanOnStart: false,
        rescanIntervalMinutes: 0,
        tmdbApiToken: 'test-token',
        anthropicApiKey: 'test-key',
        aiDailyLimit,
      },
      quiet: true,
      metadataFetch: tmdb.fetch,
      aiFetch: claude.fetch,
    })
    await state.app.init()
    await state.app.getHttpAdapter().getInstance().ready()
    state.clips = await create({ name: 'Clips', path: join(state.root, 'Clips'), kind: 'other' })
    state.library = await create({ name: 'TV', path: join(state.root, 'TV'), kind: 'shows' })
    await settle()
  }
  const stop = async () => {
    await state.app?.close()
    await rm(state.root, { recursive: true, force: true, maxRetries: 5 })
  }
  const matchAgain = async () => {
    await app().inject({ method: 'POST', url: `/api/libraries/${state.library}/match` })
    await settle()
  }
  /** The places Claude was asked about from request `from` on, each once, in order. */
  const askedSince = (from: number): string[] => [
    ...new Set(claude.state.requests.slice(from).flatMap((request) => request.place ?? [])),
  ]
  return { tmdb, claude, state, app, settle, get, start, stop, matchAgain, askedSince }
}

describe('the AI lookup', () => {
  const server = startServer({
    prefix: 'raven-ai-',
    files: [...WILD, ARCHIE, CESAR],
    aiDailyLimit: 200,
  })
  const shows = () =>
    server.get({ url: `/api/libraries/${server.state.library}/shows`, guard: isShowListing })

  beforeAll(server.start)
  afterAll(server.stop)

  it('asks once about each group the matcher left, sending nothing outside the library', () => {
    const { requests } = server.claude.state
    expect(server.askedSince(0).toSorted()).toEqual([
      'Archie',
      'Cesar 911',
      'Destination Wild Arctic',
    ])
    expect(requests).toHaveLength(7)
    expect(requests.every((request) => request.apiKey === 'test-key')).toBe(true)
    expect(requests.filter((request) => request.raw.includes(server.state.root))).toEqual([])
    expect(requests.filter((request) => request.raw.includes('Birthday'))).toEqual([])
  })

  it('matches the group it was sure of, episodes and all, and leaves the rest not matched', async () => {
    const listing = await shows()
    expect(listing.shows.map((entry) => [entry.show.title, entry.episodes])).toEqual([
      ['Wild Arctic', 2],
    ])
    expect(listing.shows[0]?.next?.match).toBe('matched')
    expect(listing.unmatched.map((file) => file.fileName).toSorted()).toEqual([
      'Archie - S01E01 - Episode 1.mp4',
      'Cesar 911 - S01E01 - Lilly.mp4',
    ])
  })

  it('asks again after Match again only where it chose no id, and never where Fix match says none', async () => {
    const asked = server.claude.state.requests.length
    await server.matchAgain()
    expect(server.askedSince(asked)).toEqual(['Cesar 911'])

    const cesar = (await shows()).unmatched.find((file) => file.fileName.startsWith('Cesar'))
    await server.app().inject({
      method: 'PUT',
      url: `/api/media/${cesar?.id ?? -1}/match`,
      payload: { tmdbId: null },
    })
    await server.settle()
    const before = server.claude.state.requests.length
    await server.matchAgain()
    expect(server.claude.state.requests).toHaveLength(before)
  })
})

describe("the AI lookup's daily limit, and Anthropic away", () => {
  const server = startServer({ prefix: 'raven-ai-limit-', files: [ARCHIE, CESAR], aiDailyLimit: 3 })

  beforeAll(async () => {
    server.claude.state.status = 529
    await server.start()
  })
  afterAll(server.stop)

  it('keeps nothing while Anthropic is away, and leaves the files not matched', async () => {
    // A full scan queues one pass, which asked about both groups before either failed.
    expect(server.askedSince(0).toSorted()).toEqual(['Archie', 'Cesar 911'])
    expect(server.claude.state.requests).toHaveLength(2)
    const listing = await server.get({
      url: `/api/libraries/${server.state.library}/shows`,
      guard: isShowListing,
    })
    expect(listing.unmatched).toHaveLength(2)
  })

  it('asks again on the next pass, as far as the day allows', async () => {
    server.claude.state.status = 200
    const asked = server.claude.state.requests.length
    await server.matchAgain()
    expect(server.askedSince(asked)).toEqual(['Archie'])
  })
})
