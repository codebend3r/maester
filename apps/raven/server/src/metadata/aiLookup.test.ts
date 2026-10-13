import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { NestFastifyApplication } from '@nestjs/platform-fastify'
import {
  isItemDetails,
  isLibrary,
  isMetadataHealth,
  isRecord,
  isShowListing,
  isUnmatchedList,
  type LibraryInput,
  type LibraryKind,
} from '@raven/core'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { createApp } from '@/app'
import { readServerConfig, type ServerConfig } from '@/config'
import { MatchFiles } from '@/metadata/matchFiles'
import { MetadataRepository } from '@/metadata/metadataRepository'
import { MetadataService } from '@/metadata/metadataService'
import { ScannerService } from '@/scanner/scannerService'
import { NOT_WATCHING } from '@/test/app'
import { encodeClip } from '@/test/clips'
import { type FakeReply, fakeClaude } from '@/test/fakeClaude'
import { type FakeMovie, type FakeShow, fakeTmdb } from '@/test/fakeTmdb'
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

/** TMDB knows the movie the misspelt folder is. */
const MOVIES: FakeMovie[] = [{ id: 949, title: 'Heat', released: '1995-12-15' }]

const WILD_REASON = "Season 1's episode titles match TMDB's (Polar Night, The Thaw)."
const ARCHIE_REASON = 'The only Archie series from 2023; its episode titles are generic.'
const HEAT_REASON = 'Heat (1995) is the only 1995 film the misspelt title fits.'

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
  'Hete (1995)': [
    { kind: 'search', type: 'movie', query: 'Heat', year: 1995 },
    { kind: 'choose', tmdbId: '949', confidence: 'high', reason: HEAT_REASON },
  ],
}

const WILD = [
  'Destination Wild Arctic/Season 1/Destination Wild Arctic - S01E01 - Polar Night.mp4',
  'Destination Wild Arctic/Season 1/Destination Wild Arctic - S01E02 - The Thaw.mp4',
]
const ARCHIE = 'Archie/Season 1/Archie - S01E01 - Episode 1.mp4'
const CESAR = 'Cesar 911/Season 1/Cesar 911 - S01E01 - Lilly.mp4'
/** Named as TMDB has it, so a search matches it with no lookup. */
const WILD_ARCTIC = 'Wild Arctic/Season 1/Wild Arctic - S01E01 - Polar Night.mp4'
const HETE = 'Hete (1995)/Hete (1995).mp4'

/**
 * A server over a temp tree, answering for TMDB and Claude: `files` in a
 * library, TV shows unless `library` says otherwise, and one video in an
 * Other library beside it. Nothing is watched; a test scans by hand.
 */
const startServer = ({
  prefix,
  files,
  aiDailyLimit,
  library = { name: 'TV', kind: 'shows' },
  config = {},
}: {
  prefix: string
  files: readonly string[]
  aiDailyLimit: number
  /** The library `files` are in, named as its folder is. */
  library?: { name: string; kind: LibraryKind }
  /** Settings over the test's own, such as a PIN. */
  config?: Partial<ServerConfig>
}) => {
  const tmdb = fakeTmdb({ movies: MOVIES, shows: SHOWS })
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
    cookie,
  }: {
    url: string
    guard: (value: unknown) => value is T
    cookie?: string
  }): Promise<T> =>
    shape({
      response: await app().inject({
        method: 'GET',
        url,
        headers: cookie == null ? {} : { cookie },
      }),
      guard,
    })
  const create = async ({ name, path, kind }: { name: string; path: string; kind: LibraryKind }) =>
    shape({
      response: await app().inject({
        method: 'POST',
        url: '/api/libraries',
        payload: { name, paths: [path], settings: { kind } },
      }),
      guard: isLibrary,
    }).id
  /** The folder the library's files are in. */
  const libraryPath = () => join(state.root, library.name)
  /** Edit library: `settings` over the library's own, as a browser holding `cookie`. */
  const update = ({ settings, cookie }: { settings: LibraryInput['settings']; cookie?: string }) =>
    app().inject({
      method: 'PUT',
      url: `/api/libraries/${state.library}`,
      payload: { name: library.name, paths: [libraryPath()], settings },
      headers: cookie == null ? {} : { cookie },
    })
  const start = async () => {
    state.root = await mkdtemp(join(tmpdir(), prefix))
    await Promise.all(
      files.map((path) => encodeClip({ path: join(libraryPath(), path), seconds: 1 })),
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
        ...config,
      },
      quiet: true,
      watch: NOT_WATCHING,
      metadataFetch: tmdb.fetch,
      aiFetch: claude.fetch,
    })
    await state.app.init()
    await state.app.getHttpAdapter().getInstance().ready()
    state.clips = await create({ name: 'Clips', path: join(state.root, 'Clips'), kind: 'other' })
    state.library = await create({ name: library.name, path: libraryPath(), kind: library.kind })
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
  const health = async () => {
    const response = await app().inject({ method: 'GET', url: '/api/health' })
    const body: unknown = response.json()
    const metadata = isRecord(body) ? body.metadata : null
    if (!isMetadataHealth(metadata)) throw new Error(`Unexpected health: ${response.body}`)
    return { metadata, body: response.body }
  }
  const unmatched = () =>
    get({ url: `/api/libraries/${state.library}/unmatched`, guard: isUnmatchedList })
  /** How many lookups were started: a lookup's first request has no reply before it. */
  const lookups = () => claude.state.requests.filter((request) => request.turn === 0).length
  /** The library's files in `folder`, as matching left them. */
  const filesIn = (folder: string) =>
    app().get(MatchFiles).inFolder({ libraryId: state.library, folder })
  return {
    tmdb,
    claude,
    state,
    app,
    settle,
    get,
    create,
    update,
    start,
    stop,
    matchAgain,
    askedSince,
    health,
    unmatched,
    lookups,
    filesIn,
  }
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

  it('lists the unsure pick beside the files it is for, and nothing for the rest', async () => {
    const files = await server.unmatched()
    expect(files.map((file) => [file.fileName, file.aiSuggestion])).toEqual([
      [
        'Archie - S01E01 - Episode 1.mp4',
        {
          tmdbId: '201000',
          title: 'Archie: The Man Who Became Cary Grant',
          year: 2023,
          poster: '/showposter201000.jpg',
          reason: ARCHIE_REASON,
        },
      ],
      ['Cesar 911 - S01E01 - Lilly.mp4', null],
    ])
  })

  it('says a show it was sure of was matched by AI, and why; never its episodes', async () => {
    const listing = await shows()
    const wild = listing.shows[0]
    const details = await server.get({
      url: `/api/items/${wild?.show.id ?? -1}`,
      guard: isItemDetails,
    })
    expect(details.aiMatch).toEqual({ reason: WILD_REASON })
    const episode = await server.get({
      url: `/api/items/${wild?.next?.item?.id ?? -1}`,
      guard: isItemDetails,
    })
    expect(episode.aiMatch).toBeNull()
  })

  it('reports the lookup in the health check, never its key', async () => {
    const { metadata, body } = await server.health()
    expect(metadata).toMatchObject({ ai: 'ok', aiRemaining: 200 - server.lookups() })
    expect(body).not.toContain('test-key')
  })

  it('takes an accepted suggestion as a Fix match, which no AI note claims', async () => {
    const archie = (await server.unmatched()).find((file) => file.aiSuggestion != null)
    await server.app().inject({
      method: 'PUT',
      url: `/api/media/${archie?.id ?? -1}/match`,
      payload: { tmdbId: archie?.aiSuggestion?.tmdbId },
    })
    await server.settle()
    expect((await server.unmatched()).map((file) => file.fileName)).toEqual([
      'Cesar 911 - S01E01 - Lilly.mp4',
    ])
    const listing = await shows()
    const accepted = listing.shows.find((entry) => entry.show.title.startsWith('Archie'))
    expect(accepted?.next?.match).toBe('manual')
    const details = await server.get({
      url: `/api/items/${accepted?.show.id ?? -1}`,
      guard: isItemDetails,
    })
    expect(details.aiMatch).toBeNull()
  })
})

describe("the AI lookup's daily limit, and Anthropic away", () => {
  const server = startServer({ prefix: 'raven-ai-limit-', files: [ARCHIE, CESAR], aiDailyLimit: 3 })

  beforeAll(async () => {
    server.claude.state.status = 529
    await server.start()
  })
  afterAll(server.stop)

  it('is failing in the health check while Anthropic is away', async () => {
    expect((await server.health()).metadata).toMatchObject({ ai: 'failing', aiRemaining: 1 })
    expect((await server.unmatched()).map((file) => file.aiSuggestion)).toEqual([null, null])
  })

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
    expect((await server.health()).metadata).toMatchObject({ ai: 'ok', aiRemaining: 0 })
  })
})

describe('a library given up on during the lookups', () => {
  const server = startServer({
    prefix: 'raven-ai-gone-',
    files: [ARCHIE, CESAR, WILD[0] ?? ''],
    aiDailyLimit: 200,
  })
  afterAll(server.stop)

  it('is not looked up any more once it is no longer a matched type', async () => {
    const places = ['Archie', 'Cesar 911', 'Destination Wild Arctic']
    const releases = places.map((place) => server.claude.hold(place))
    const started = server.start()
    const { requests } = server.claude.state
    await vi.waitFor(() => expect(requests).toHaveLength(2))
    const response = await server.update({ settings: { kind: 'other' } })
    expect(response.statusCode).toBe(200)
    releases.forEach((release) => release())
    await started
    // The two lookups under way finish their turns; the third is never started.
    expect(requests).toHaveLength(4)
    expect(requests.filter((request) => request.place === 'Destination Wild Arctic')).toEqual([])
  })
})

describe('files that land while the lookups run', () => {
  const server = startServer({ prefix: 'raven-ai-late-', files: [ARCHIE], aiDailyLimit: 200 })
  afterAll(server.stop)

  it('are matched by a pass that follows the one under way', async () => {
    const release = server.claude.hold('Archie')
    const started = server.start()
    await vi.waitFor(() => expect(server.claude.state.requests).toHaveLength(1), {
      timeout: 10_000,
    })
    await encodeClip({ path: join(server.state.root, 'TV', WILD_ARCTIC), seconds: 1 })
    await server
      .app()
      .inject({ method: 'POST', url: `/api/libraries/${server.state.library}/scan` })
    await server.app().get(ScannerService).whenIdle(server.state.library)
    release()
    await started
    const listing = await server.get({
      url: `/api/libraries/${server.state.library}/shows`,
      guard: isShowListing,
    })
    expect(listing.shows.map((entry) => [entry.show.title, entry.next?.match])).toEqual([
      ['Wild Arctic', 'matched'],
    ])
    expect(listing.unmatched.map((file) => file.fileName)).toEqual([
      'Archie - S01E01 - Episode 1.mp4',
    ])
  })
})

describe('a suggestion where Fix match has answered', () => {
  const server = startServer({ prefix: 'raven-ai-fixed-', files: [ARCHIE], aiDailyLimit: 200 })

  beforeAll(server.start)
  afterAll(server.stop)

  it('is not offered once Fix match says the group is not a show', async () => {
    const [archie] = await server.unmatched()
    expect(archie?.aiSuggestion?.tmdbId).toBe('201000')
    await server.app().inject({
      method: 'PUT',
      url: `/api/media/${archie?.id ?? -1}/match`,
      payload: { tmdbId: null },
    })
    await server.settle()
    expect((await server.unmatched()).map((file) => [file.fileName, file.aiSuggestion])).toEqual([
      ['Archie - S01E01 - Episode 1.mp4', null],
    ])
  })
})

describe('the AI lookup in a library of movies', () => {
  const server = startServer({
    prefix: 'raven-ai-movies-',
    files: [HETE],
    aiDailyLimit: 200,
    library: { name: 'Movies', kind: 'movies' },
  })
  const heat = () => server.app().get(MetadataRepository).find({ type: 'movie', tmdbId: '949' })
  const details = () => server.get({ url: `/api/items/${heat()?.id ?? -1}`, guard: isItemDetails })

  beforeAll(server.start)
  afterAll(server.stop)

  it('matches a movie it was sure of, and says so on its page', async () => {
    expect(server.askedSince(0)).toEqual(['Hete (1995)'])
    expect(server.filesIn('Hete (1995)').map((file) => file.match)).toEqual(['matched'])
    expect((await details()).aiMatch).toEqual({ reason: HEAT_REASON })
  })

  it('keeps the movie and its edit through a change to Anime movies while Anthropic is away', async () => {
    const edited = await server.app().inject({
      method: 'PUT',
      url: `/api/items/${heat()?.id ?? -1}/metadata`,
      payload: { title: 'Heat (the long cut)' },
    })
    expect(edited.statusCode).toBe(200)
    server.claude.state.status = 529
    try {
      expect((await server.update({ settings: { kind: 'animeMovies' } })).statusCode).toBe(200)
      await server.settle()
    } finally {
      server.claude.state.status = 200
    }
    expect(server.filesIn('Hete (1995)').map((file) => file.match)).toEqual(['matched'])
    expect(await details()).toMatchObject({
      title: 'Heat (the long cut)',
      aiMatch: { reason: HEAT_REASON },
    })
  })
})
