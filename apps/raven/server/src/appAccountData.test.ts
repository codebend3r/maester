import { copyFile, mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { NestFastifyApplication } from '@nestjs/platform-fastify'
import {
  AUTH_CONFIG_STATES,
  AUTH_HEADERS,
  AUTH_REFUSALS,
  HOME_SHELF_TYPES,
  type HistoryEntry,
  ITEM_TYPES,
  LIBRARY_KINDS,
  MEMBER_STATUSES,
  type MediaItem,
  WATCH_TARGET_KINDS,
  createApiClient,
  isMediaItem,
  isMediaTicket,
} from '@raven/core'
import { CACHE_POLICIES, ENCODINGS, HEADERS } from '@shared/server'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { createApp } from '@/app'
import type { ServerConfig } from '@/config'
import { DatabaseService } from '@/db/database'
import { RAVEN_HEADERS } from '@/http'
import { VIEWING_ACCOUNTS } from '@/media/viewingAccountKeys'
import type { AdoptedCounts } from '@/media/viewingAdoption'
import { MetadataService } from '@/metadata/metadataService'
import { ScannerService } from '@/scanner/scannerService'
import { ThumbnailService } from '@/thumbnails/thumbnailService'
import { NOT_WATCHING, ROUTE_METHODS, adminCookie, testConfig } from '@/test/app'
import { AUTH_TEST_CONFIG, AUTH_TEST_IDS, authFixture, bearerHeaders } from '@/test/auth'
import { encodeClip } from '@/test/clips'
import { fakeTmdb } from '@/test/fakeTmdb'
import {
  CALLER_KINDS,
  type CallerKind,
  ENFORCED_TITLES,
  ROUTES,
  type LeftoverIds,
  type Route,
  type ShowIds,
  TOKEN_CARRIERS,
  addLeftovers,
  addShow,
  createEnforcedApp,
  headersFor,
  outcomeOf,
  pathOf,
  withTicket,
} from '@/test/enforced'
import { viewingCountsOf } from '@/test/repositories'
import { apiFor, injectFetch } from '@/test/server'

/** Further in than the one-second clips of the other suites, so the spot is kept. */
const MOVIE_SECONDS = 60
const SPOT = 30
const SEARCH = 'Matrix'

let root: string
let fixture: Awaited<ReturnType<typeof authFixture>>
let enforced: Awaited<ReturnType<typeof createEnforcedApp>>
let tv: ShowIds
let extra: LeftoverIds

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'raven-account-data-'))
  fixture = await authFixture()
  enforced = await createEnforcedApp({ root, fixture, movieSeconds: MOVIE_SECONDS })
  tv = await addShow({ root, enforced })
  extra = await addLeftovers({ enforced })
})

afterAll(async () => {
  await enforced.app.close()
  await rm(root, { recursive: true, force: true, maxRetries: 5 })
})

type ClientForProps = { id: string }

const clientFor = async ({ id }: ClientForProps) => {
  const token = await fixture.mint({ id })
  return createApiClient({ fetch: injectFetch({ app: enforced.app }), accessToken: () => token })
}

type Client = Awaited<ReturnType<typeof clientFor>>

/** What a video's card says about the one looking: where it resumes, and whether it is theirs. */
const viewOf = ({ position, favourite, watched }: MediaItem) => ({ position, favourite, watched })

const markOf = ({
  media,
  plays,
  watched,
  marked,
}: Pick<HistoryEntry, 'media' | 'plays' | 'watched' | 'marked'>) => ({
  id: media.id,
  plays,
  watched,
  marked,
})

/** A video's card as one account sees it, named by the file. */
const cardOf = (media: MediaItem) => ({ id: media.id, ...viewOf(media) })

const ascending = (a: number, b: number): number => a - b

type ByIdProps = { id: number }

type ById2Props = { id: number }

const byId = (a: ByIdProps, b: ById2Props): number => a.id - b.id

type ViewingOfProps = { api: Client }

/** Everything the per-account routes tell one account, boiled down to what differs between accounts. */
const viewingOf = async ({ api }: ViewingOfProps) => {
  const { library, video } = enforced.ids
  const [movie, movies, history, showHistory, inProgress, libraryFavourites] = await Promise.all([
    api.getMedia(video),
    api.listMedia({ libraryId: library }),
    api.listHistory({ libraryId: library, limit: 10 }),
    api.listHistory({ libraryId: tv.library, limit: 10 }),
    api.listInProgress(library),
    api.listLibraryFavourites(library),
  ])
  const [favourites, titles, home, found, details, season, next, listing, shuffled] =
    await Promise.all([
      api.listFavourites(),
      api.listFavouriteTitles(),
      api.getHome(),
      api.searchHome(SEARCH),
      api.getItem(tv.show),
      api.getItem(tv.season),
      api.nextEpisode(tv.show),
      api.listShows({ libraryId: tv.library }),
      api.shuffleEpisodes(tv.show),
    ])
  const [unmatched, duplicates] = await Promise.all([
    api.listUnmatched(library),
    api.listDuplicates(library),
  ])
  return {
    movie: viewOf(movie),
    movies: movies.map(cardOf),
    history: history.map(markOf).toSorted(byId),
    showHistory: showHistory.map(markOf),
    inProgress: inProgress.map(({ media }) => media.id).toSorted(ascending),
    libraryFavourites: libraryFavourites.map(({ media }) => media.id).toSorted(ascending),
    favourites: favourites.map(({ media }) => media.id).toSorted(ascending),
    titles: titles.map(({ id }) => id),
    homeInProgress: home.inProgress.map(({ media }) => media.id).toSorted(ascending),
    unmatched: unmatched.map(cardOf),
    duplicates: duplicates.map(({ cards }) =>
      cards.map(({ files }) => files.map(({ media }) => cardOf(media))),
    ),
    searched: found.flatMap((shelf) =>
      shelf.type === HOME_SHELF_TYPES.media ? shelf.media.map(cardOf) : [],
    ),
    isShowFavourite: details.favourite,
    seasonWatchedCounts: details.children.map((child) =>
      child.type === ITEM_TYPES.season ? child.watchedCount : null,
    ),
    episodesWatched: season.children.map((child) =>
      child.type === ITEM_TYPES.episode ? child.watched : null,
    ),
    next: next?.id ?? null,
    listing: listing.shows.map((entry) => ({
      watchedEpisodes: entry.watchedEpisodes,
      next: entry.next?.id ?? null,
    })),
    shuffled: shuffled.map(cardOf).toSorted(byId),
  }
}

type RecordMemberViewingProps = { api: Client }

/**
 * The member's viewing, safe to record again: the movie half watched and a favourite, the extra
 * files with a spot and a favourite, the show a favourite, its first episode marked.
 */
const recordMemberViewing = async ({ api }: RecordMemberViewingProps) => {
  const { video } = enforced.ids
  const [first] = tv.episodes
  await Promise.all(
    [extra.unmatched, extra.duplicate].map(async (id) => {
      await api.saveProgress({ id, position: SPOT, audio: null })
      await api.setFavourite({ id, favourite: true })
    }),
  )
  await api.saveProgress({ id: video, position: SPOT, audio: null })
  await api.recordPlay(video)
  await api.setFavourite({ id: video, favourite: true })
  await api.setItemFavourite({ id: tv.show, favourite: true })
  await api.setWatched({ watched: true, targets: [{ kind: WATCH_TARGET_KINDS.media, id: first }] })
}

const NOBODYS = { position: 0, favourite: false, watched: false } as const

describe('each account sees only its own viewing', () => {
  it("keeps each account's viewing to itself", async () => {
    const member = await clientFor({ id: AUTH_TEST_IDS.friend })
    const guest = await clientFor({ id: AUTH_TEST_IDS.guest })
    await recordMemberViewing({ api: member })
    const { video } = enforced.ids
    const [first, second] = tv.episodes
    const { unmatched, duplicate } = extra
    const spot = { position: SPOT, favourite: true, watched: false }
    const played = { plays: 1, watched: false, marked: false }
    expect(await viewingOf({ api: member })).toEqual({
      movie: spot,
      movies: [
        { id: video, ...spot },
        { id: unmatched, ...spot },
      ],
      history: [
        { id: video, ...played },
        { id: duplicate, ...played },
        { id: unmatched, ...played },
      ].toSorted(byId),
      showHistory: [{ id: first, plays: 0, watched: true, marked: true }],
      inProgress: [video, duplicate, unmatched].toSorted(ascending),
      libraryFavourites: [video, duplicate, unmatched].toSorted(ascending),
      favourites: [video, duplicate, unmatched].toSorted(ascending),
      titles: [tv.show],
      homeInProgress: [video, duplicate, unmatched].toSorted(ascending),
      unmatched: [{ id: unmatched, ...spot }],
      duplicates: [
        [
          [
            { id: video, ...spot },
            { id: duplicate, ...spot },
          ],
        ],
      ],
      searched: [{ id: video, ...spot }],
      isShowFavourite: true,
      seasonWatchedCounts: [1],
      episodesWatched: [true, false],
      next: second,
      listing: [{ watchedEpisodes: 1, next: second }],
      shuffled: [
        { id: first, ...NOBODYS, watched: true },
        { id: second, ...NOBODYS },
      ],
    })
    expect(await viewingOf({ api: guest })).toEqual({
      movie: NOBODYS,
      movies: [
        { id: video, ...NOBODYS },
        { id: unmatched, ...NOBODYS },
      ],
      history: [],
      showHistory: [],
      inProgress: [],
      libraryFavourites: [],
      favourites: [],
      titles: [],
      homeInProgress: [],
      unmatched: [{ id: unmatched, ...NOBODYS }],
      duplicates: [
        [
          [
            { id: video, ...NOBODYS },
            { id: duplicate, ...NOBODYS },
          ],
        ],
      ],
      searched: [{ id: video, ...NOBODYS }],
      isShowFavourite: false,
      seasonWatchedCounts: [0],
      episodesWatched: [false, false],
      next: first,
      listing: [{ watchedEpisodes: 0, next: first }],
      shuffled: [
        { id: first, ...NOBODYS },
        { id: second, ...NOBODYS },
      ],
    })
  })

  it('answers per-account reads uncached', async () => {
    const { library, video } = enforced.ids
    const reads: { route: Route; params: Record<string, number> }[] = [
      { route: ROUTES.libraryMedia, params: { id: library } },
      { route: ROUTES.shows, params: { id: tv.library } },
      { route: ROUTES.history, params: { id: library } },
      { route: ROUTES.inProgress, params: { id: library } },
      { route: ROUTES.libraryFavourites, params: { id: library } },
      { route: ROUTES.sagas, params: { id: library } },
      { route: ROUTES.unmatched, params: { id: library } },
      { route: ROUTES.duplicates, params: { id: library } },
      { route: ROUTES.media, params: { id: video } },
      { route: ROUTES.item, params: { id: tv.show } },
      { route: ROUTES.nextEpisode, params: { id: tv.show } },
      { route: ROUTES.shuffle, params: { id: tv.show } },
      { route: ROUTES.home, params: {} },
      { route: ROUTES.homeSearch, params: {} },
      { route: ROUTES.favourites, params: {} },
      { route: ROUTES.favouriteTitles, params: {} },
    ]
    const writes: { route: Route; params: Record<string, number>; payload?: object }[] = [
      { route: ROUTES.progress, params: { id: video }, payload: { position: SPOT } },
      { route: ROUTES.plays, params: { id: video } },
      { route: ROUTES.mediaFavourite, params: { id: video }, payload: { favourite: true } },
      { route: ROUTES.itemFavourite, params: { id: tv.show }, payload: { favourite: true } },
      {
        route: ROUTES.watched,
        params: {},
        payload: {
          watched: true,
          targets: [{ kind: WATCH_TARGET_KINDS.media, id: tv.episodes[0] }],
        },
      },
    ]
    const headers = {
      [TOKEN_CARRIERS.bearer]: await headersFor({
        fixture,
        caller: CALLER_KINDS.member,
        via: TOKEN_CARRIERS.bearer,
      }),
      [TOKEN_CARRIERS.cookie]: await headersFor({
        fixture,
        caller: CALLER_KINDS.member,
        via: TOKEN_CARRIERS.cookie,
      }),
    }
    const sent = [
      ...reads.flatMap(({ route, params }) =>
        Object.values(TOKEN_CARRIERS).map((via) => ({
          route,
          via,
          params,
          payload: undefined,
        })),
      ),
      ...writes.map(({ route, params, payload }) => ({
        route,
        via: TOKEN_CARRIERS.bearer,
        params,
        payload,
      })),
    ]
    const observed = await Promise.all(
      sent.map(async ({ route, via, params, payload }) => {
        const response = await enforced.app.inject({
          method: route.method,
          url: pathOf({ route, params }),
          headers: headers[via],
          ...(payload === undefined ? {} : { payload }),
        })
        const { status, isNoStore, isVariedByAccount } = outcomeOf({ response })
        return {
          path: route.path,
          method: route.method,
          via,
          isOk: status < 300,
          isNoStore,
          isVariedByAccount,
        }
      }),
    )
    expect(observed).toEqual(
      sent.map(({ route, via }) => ({
        path: route.path,
        method: route.method,
        via,
        isOk: true,
        isNoStore: true,
        isVariedByAccount: true,
      })),
    )
    expect(observed.some(({ method }) => method === ROUTE_METHODS.put)).toBe(true)
  })

  it.each(Object.values(TOKEN_CARRIERS))(
    'names the encoding a compressed library listing varies by, sent by %s',
    async (via) => {
      const response = await enforced.app.inject({
        url: pathOf({ route: ROUTES.libraryMedia, params: { id: tv.library } }),
        headers: {
          ...(await headersFor({ fixture, caller: CALLER_KINDS.member, via })),
          [HEADERS.acceptEncoding]: ENCODINGS.gzip,
        },
      })
      const vary = String(response.headers[HEADERS.vary] ?? '')
      expect(response.headers[HEADERS.contentEncoding]).toBe(ENCODINGS.gzip)
      expect(response.headers[HEADERS.cacheControl]).toBe(CACHE_POLICIES.noStore)
      ;[HEADERS.acceptEncoding, AUTH_HEADERS.authorization, AUTH_HEADERS.cookie].forEach((name) =>
        expect(vary).toContain(name),
      )
    },
  )

  it("keeps a removed account's viewing for when it returns", async () => {
    const owner = await clientFor({ id: AUTH_TEST_IDS.owner })
    const member = await clientFor({ id: AUTH_TEST_IDS.friend })
    const guest = await clientFor({ id: AUTH_TEST_IDS.guest })
    await recordMemberViewing({ api: member })
    const before = await viewingOf({ api: member })
    const guestBefore = await viewingOf({ api: guest })
    expect(before.movie.favourite).toBe(true)

    type ReadMediaProps = { caller: CallerKind }

    const readMedia = async ({ caller }: ReadMediaProps) =>
      enforced.app.inject({
        url: pathOf({ route: ROUTES.media, params: { id: enforced.ids.video } }),
        headers: await headersFor({ fixture, caller, via: TOKEN_CARRIERS.bearer }),
      })
    await owner.setMemberStatus({
      id: AUTH_TEST_IDS.friend,
      change: { status: MEMBER_STATUSES.revoked },
    })
    expect(outcomeOf({ response: await readMedia({ caller: CALLER_KINDS.member }) })).toMatchObject(
      {
        status: 403,
        reason: AUTH_REFUSALS.revoked,
      },
    )
    const guestBody: unknown = (await readMedia({ caller: CALLER_KINDS.guest })).json()
    expect(isMediaItem(guestBody) ? viewOf(guestBody) : null).toEqual(NOBODYS)

    await owner.setMemberStatus({
      id: AUTH_TEST_IDS.friend,
      change: { status: MEMBER_STATUSES.approved },
    })
    expect(await viewingOf({ api: member })).toEqual(before)
    expect(await viewingOf({ api: guest })).toEqual(guestBefore)
  })
})

/** How a server starts on a data dir that outlives it: without accounts, with them, or opted out after them. */
const SERVER_MODES = { off: 'off', ready: 'ready', optedOut: 'optedOut' } as const

type ServerMode = (typeof SERVER_MODES)[keyof typeof SERVER_MODES]

const ACCOUNTS_OFF = { state: AUTH_CONFIG_STATES.off } as const

const ACCOUNTS_BY_MODE = {
  [SERVER_MODES.off]: { auth: ACCOUNTS_OFF, isAccountsOptedOut: false },
  [SERVER_MODES.ready]: { auth: AUTH_TEST_CONFIG, isAccountsOptedOut: false },
  [SERVER_MODES.optedOut]: { auth: ACCOUNTS_OFF, isAccountsOptedOut: true },
} as const satisfies Record<ServerMode, Pick<ServerConfig, 'auth' | 'isAccountsOptedOut'>>

const PAST_FILES = {
  movie: 'The Matrix (1999).mp4',
  other: 'Zzxq Qwvb Unmatchable.mp4',
  later: 'Qwvb Zzxq Unmatchable.mp4',
} as const

/** Long before anything a test records, so any spot of the owner's is newer. */
const LONG_AGO = new Date(Date.UTC(2000, 0, 1)).toISOString()
const EARLIER_SPOT = 10

/** Where the past is, once `recordThePast` has made it. */
type Past = {
  dir: string
  library: number
  ids: { [K in keyof typeof PAST_FILES]: number }
  tv: ShowIds
}

describe("the owner's Streams page", () => {
  it('names the account watching, and the audio track its player reports', async () => {
    const token = await fixture.mint({ id: AUTH_TEST_IDS.friend })
    const browser = { [RAVEN_HEADERS.userAgent]: 'Friend Browser' }
    const minted: unknown = (
      await enforced.app.inject({
        method: ROUTES.accountTicket.method,
        url: pathOf({ route: ROUTES.accountTicket, params: { id: enforced.ids.video } }),
        headers: bearerHeaders({ token }),
      })
    ).json()
    if (!isMediaTicket(minted)) throw new Error('No ticket was minted')
    const played = await enforced.app.inject({
      url: withTicket({
        route: ROUTES.file,
        params: { id: enforced.ids.video },
        ticket: minted.ticket,
      }),
      headers: { ...browser, [HEADERS.range]: 'bytes=0-99' },
    })
    expect(played.statusCode).toBe(206)
    const reported = await enforced.app.inject({
      method: ROUTES.progress.method,
      url: pathOf({ route: ROUTES.progress, params: { id: enforced.ids.video } }),
      headers: { ...browser, ...bearerHeaders({ token }) },
      payload: { position: SPOT, audio: 0 },
    })
    expect(reported.statusCode).toBe(204)

    const owner = await clientFor({ id: AUTH_TEST_IDS.owner })
    const streams = await owner.listLiveStreams()
    expect(streams).toEqual([
      expect.objectContaining({
        viewer: 'friend@maester.test',
        position: SPOT,
        audio: 0,
        quality: null,
      }),
    ])
    await Promise.all(streams.map(({ id }) => owner.stopStream(id)))
  })
})

describe('the viewing from before accounts', () => {
  const state: { clips: string; dirs: string[]; servers: Set<NestFastifyApplication> } = {
    clips: '',
    dirs: [],
    servers: new Set(),
  }

  beforeAll(async () => {
    state.clips = await mkdtemp(join(tmpdir(), 'raven-account-past-clips-'))
    await encodeClip({ path: join(state.clips, PAST_FILES.movie), seconds: MOVIE_SECONDS })
  })

  afterEach(async () => {
    await Promise.all([...state.servers].map((server) => server.close()))
    state.servers.clear()
  })

  afterAll(async () => {
    await Promise.all(
      [state.clips, ...state.dirs].map((dir) =>
        rm(dir, { recursive: true, force: true, maxRetries: 5 }),
      ),
    )
  })

  type StartOnProps = { dir: string; mode: ServerMode }

  const startOn = async ({ dir, mode }: StartOnProps) => {
    const app = await createApp({
      config: {
        ...testConfig({ dataDir: join(dir, 'data'), mediaDir: join(dir, 'media') }),
        ...ACCOUNTS_BY_MODE[mode],
        tmdbApiToken: 'test-token',
      },
      authKeys: fixture.keys,
      authFetch: fixture.fetcher,
      metadataFetch: fakeTmdb(ENFORCED_TITLES).fetch,
      quiet: true,
      watch: NOT_WATCHING,
    })
    state.servers.add(app)
    await app.init()
    await app.getHttpAdapter().getInstance().ready()
    return app
  }

  type StopProps = { app: NestFastifyApplication }

  const stop = async ({ app }: StopProps) => {
    state.servers.delete(app)
    await app.close()
  }

  type ClientOnProps = { app: NestFastifyApplication; id: string }

  const clientOn = async ({ app, id }: ClientOnProps) => {
    const token = await fixture.mint({ id })
    return createApiClient({ fetch: injectFetch({ app }), accessToken: () => token })
  }

  type PastRowsProps = { app: NestFastifyApplication }

  /** How many rows from before accounts each viewing table still holds. */
  const pastRows = ({ app }: PastRowsProps) =>
    viewingCountsOf({ database: app.get(DatabaseService), account: VIEWING_ACCOUNTS.local })

  const NO_PAST = {
    spots: 0,
    plays: 0,
    favourites: 0,
    titleFavourites: 0,
  } as const satisfies AdoptedCounts

  type SpotOwnersProps = { app: NestFastifyApplication; mediaId: number }

  /** Whose spots on `mediaId` are kept, by account. */
  const spotOwners = ({ app, mediaId }: SpotOwnersProps) =>
    app
      .get(DatabaseService)
      .db.prepare<[number], { account_id: string }>(
        'SELECT account_id FROM playback_progress WHERE media_id = ? ORDER BY account_id',
      )
      .all(mediaId)
      .map(({ account_id }) => account_id)

  /**
   * A server without accounts, on which the one shared viewer saved a spot
   * on The Matrix, played it and made it a favourite, made Andor a favourite
   * and marked its first episode, before the server is closed.
   */
  const recordThePast = async (): Promise<Past> => {
    const dir = await mkdtemp(join(tmpdir(), 'raven-account-past-'))
    state.dirs.push(dir)
    const mediaDir = join(dir, 'media')
    await mkdir(mediaDir, { recursive: true })
    await Promise.all(
      Object.values(PAST_FILES).map((name) =>
        copyFile(join(state.clips, PAST_FILES.movie), join(mediaDir, name)),
      ),
    )
    const app = await startOn({ dir, mode: SERVER_MODES.off })
    const admin = apiFor({ app, cookie: await adminCookie(app) })
    const library = await admin.createLibrary({
      name: 'Movies',
      paths: [mediaDir],
      settings: { kind: LIBRARY_KINDS.movies },
    })
    await app.get(ScannerService).whenIdle(library.id)
    await app.get(MetadataService).whenIdle()
    await app.get(ThumbnailService).whenIdle()
    const shows = await addShow({ root: dir, enforced: { app, ownerApi: admin } })
    const files = await admin.listMedia({ libraryId: library.id })
    const idOf = (name: string): number => files.find(({ fileName }) => fileName === name)?.id ?? -1
    const ids = {
      movie: idOf(PAST_FILES.movie),
      other: idOf(PAST_FILES.other),
      later: idOf(PAST_FILES.later),
    }
    const viewer = apiFor({ app })
    await viewer.saveProgress({ id: ids.movie, position: SPOT, audio: null })
    await viewer.recordPlay(ids.movie)
    await viewer.setFavourite({ id: ids.movie, favourite: true })
    await viewer.setItemFavourite({ id: shows.show, favourite: true })
    await viewer.setWatched({
      watched: true,
      targets: [{ kind: WATCH_TARGET_KINDS.media, id: shows.episodes[0] }],
    })
    await stop({ app })
    return { dir, library: library.id, ids, tv: shows }
  }

  type PastOfProps = { api: Client; past: Past }

  /** What one account is shown of the past: the movie's card, Home, favourites and history. */
  const pastOf = async ({ api, past }: PastOfProps) => {
    const [movie, home, favourites, titles, history, showHistory] = await Promise.all([
      api.getMedia(past.ids.movie),
      api.getHome(),
      api.listFavourites(),
      api.listFavouriteTitles(),
      api.listHistory({ libraryId: past.library, limit: 10 }),
      api.listHistory({ libraryId: past.tv.library, limit: 10 }),
    ])
    return {
      movie: viewOf(movie),
      homeInProgress: home.inProgress.map(({ media }) => media.id).toSorted(ascending),
      favourites: favourites.map(({ media }) => media.id),
      titles: titles.map(({ id }) => id),
      history: history.map(markOf),
      showHistory: showHistory.map(markOf),
    }
  }

  const NONE_OF_IT = {
    movie: NOBODYS,
    homeInProgress: [],
    favourites: [],
    titles: [],
    history: [],
    showHistory: [],
  }

  const allOf = (past: Past) => ({
    movie: { position: SPOT, favourite: true, watched: false },
    homeInProgress: [past.ids.movie],
    favourites: [past.ids.movie],
    titles: [past.tv.show],
    history: [{ id: past.ids.movie, plays: 1, watched: false, marked: false }],
    showHistory: [{ id: past.tv.episodes[0], plays: 0, watched: true, marked: true }],
  })

  type AdoptThePastProps = { past: Past }

  /** Starts `ready` on the past and lets the owner's first request adopt it. */
  const adoptThePast = async ({ past }: AdoptThePastProps) => {
    const app = await startOn({ dir: past.dir, mode: SERVER_MODES.ready })
    await (await clientOn({ app, id: AUTH_TEST_IDS.owner })).getHome()
    return app
  }

  it('gives the owner what was watched before accounts', async () => {
    const past = await recordThePast()
    const app = await startOn({ dir: past.dir, mode: SERVER_MODES.ready })
    const member = await clientOn({ app, id: AUTH_TEST_IDS.friend })
    const owner = await clientOn({ app, id: AUTH_TEST_IDS.owner })

    expect(await pastOf({ api: member, past })).toEqual(NONE_OF_IT)
    expect(pastRows({ app })).toEqual({ spots: 1, plays: 2, favourites: 1, titleFavourites: 1 })

    const home = await owner.getHome()
    expect(home.inProgress.map(({ media }) => media.id)).toEqual([past.ids.movie])
    expect(await pastOf({ api: owner, past })).toEqual(allOf(past))
    expect(await pastOf({ api: member, past })).toEqual(NONE_OF_IT)
    expect(pastRows({ app })).toEqual(NO_PAST)
  })

  it("lets servers without accounts keep the owner's viewing after a rollback", async () => {
    const past = await recordThePast()
    await stop({ app: await adoptThePast({ past }) })

    const rolledBack = await startOn({ dir: past.dir, mode: SERVER_MODES.optedOut })
    const anonymous = apiFor({ app: rolledBack })
    expect((await anonymous.getMedia(past.ids.movie)).position).toBe(SPOT)
    await anonymous.saveProgress({ id: past.ids.other, position: SPOT, audio: null })
    expect(spotOwners({ app: rolledBack, mediaId: past.ids.other })).toEqual([AUTH_TEST_IDS.owner])
    expect(pastRows({ app: rolledBack })).toEqual(NO_PAST)
    await stop({ app: rolledBack })

    const app = await startOn({ dir: past.dir, mode: SERVER_MODES.ready })
    const owner = await clientOn({ app, id: AUTH_TEST_IDS.owner })
    const member = await clientOn({ app, id: AUTH_TEST_IDS.friend })
    expect((await pastOf({ api: owner, past })).homeInProgress).toEqual(
      [past.ids.movie, past.ids.other].toSorted(ascending),
    )
    expect((await pastOf({ api: member, past })).homeInProgress).toEqual([])
  })

  it('merges a later adoption', async () => {
    const past = await recordThePast()
    const adopted = await adoptThePast({ past })
    const spot = adopted.get(DatabaseService).db.prepare<{
      account: string
      mediaId: number
      position: number
      at: string
    }>(
      `INSERT INTO playback_progress (account_id, media_id, position, updated_at)
       VALUES (@account, @mediaId, @position, @at)`,
    )
    spot.run({
      account: VIEWING_ACCOUNTS.local,
      mediaId: past.ids.movie,
      position: EARLIER_SPOT,
      at: LONG_AGO,
    })
    spot.run({
      account: VIEWING_ACCOUNTS.local,
      mediaId: past.ids.later,
      position: SPOT,
      at: new Date().toISOString(),
    })
    await stop({ app: adopted })

    const app = await startOn({ dir: past.dir, mode: SERVER_MODES.ready })
    const owner = await clientOn({ app, id: AUTH_TEST_IDS.owner })
    const home = await owner.getHome()
    expect(home.inProgress.map(({ media }) => media.id).toSorted(ascending)).toEqual(
      [past.ids.movie, past.ids.later].toSorted(ascending),
    )
    expect((await owner.getMedia(past.ids.movie)).position).toBe(SPOT)
    expect(spotOwners({ app, mediaId: past.ids.movie })).toEqual([AUTH_TEST_IDS.owner])
    expect(pastRows({ app })).toEqual(NO_PAST)
  })
})
