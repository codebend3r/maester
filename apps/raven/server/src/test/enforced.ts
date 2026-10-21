import { copyFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { NestFastifyApplication } from '@nestjs/platform-fastify'
import {
  AUTH_HEADERS,
  AUTH_PATHS,
  BUG_REPORT_PATHS,
  type ApiClient,
  HLS_PARAMS,
  HLS_PATHS,
  ITEM_TYPES,
  LIBRARY_KINDS,
  MEDIA_TICKET_PARAM,
  type MediaOrigin,
  PICTURE_PATHS,
  createApiClient,
  isAuthRefusal,
} from '@raven/core'
import { CACHE_POLICIES, CONTENT_TYPES, HEADERS } from '@shared/server'
import { createApp } from '@/app'
import { ACCOUNT_REQUIREMENTS } from '@/auth/accountGuard'
import { MetadataRepository } from '@/metadata/metadataRepository'
import { MetadataService } from '@/metadata/metadataService'
import { ScannerService } from '@/scanner/scannerService'
import { ThumbnailService } from '@/thumbnails/thumbnailService'
import { NOT_WATCHING, ROUTE_METHODS, testConfig } from '@/test/app'
import {
  AUTH_TEST_CONFIG,
  AUTH_TEST_IDS,
  authCookie,
  authFixture,
  bearerHeaders,
} from '@/test/auth'
import { encodeClip } from '@/test/clips'
import { type FakeShow, fakeTmdb } from '@/test/fakeTmdb'
import { injectFetch } from '@/test/server'

const { get: GET, post: POST, put: PUT, delete: DELETE } = ROUTE_METHODS
const { anyone, session, approved, owner } = ACCOUNT_REQUIREMENTS

/**
 * Every route the server declares, with the account it asks for once
 * accounts are `ready`. A route missing here, or declared differently, fails
 * the inventory test, so a new route is never open by accident.
 */
export const ROUTES = {
  adminLock: { method: GET, path: '/api/admin', account: approved },
  adminKeepUnlocked: { method: POST, path: '/api/admin/keep-unlocked', account: approved },
  adminRelock: { method: POST, path: '/api/admin/lock', account: approved },
  adminUnlock: { method: POST, path: '/api/admin/unlock', account: approved },
  authConfig: { method: GET, path: AUTH_PATHS.config, account: anyone },
  accountTicket: { method: POST, path: AUTH_PATHS.ticket, account: approved },
  members: { method: GET, path: AUTH_PATHS.members, account: owner },
  memberStatus: { method: POST, path: AUTH_PATHS.memberStatus, account: owner },
  events: { method: GET, path: '/api/events', account: approved },
  favourites: { method: GET, path: '/api/favourites', account: approved },
  favouriteTitles: { method: GET, path: '/api/favourites/titles', account: approved },
  browse: { method: GET, path: '/api/fs/browse', account: owner },
  health: { method: GET, path: '/api/health', account: anyone },
  home: { method: GET, path: '/api/home', account: approved },
  homeHero: { method: GET, path: '/api/home/hero', account: approved },
  homeSearch: { method: GET, path: '/api/home/search', account: approved },
  heroPicks: { method: GET, path: '/api/hero/picks', account: owner },
  setHeroPick: { method: PUT, path: '/api/hero/picks', account: owner },
  cachedImage: { method: GET, path: '/api/images/:use/:file', account: approved },
  item: { method: GET, path: '/api/items/:id', account: approved },
  itemFavourite: { method: PUT, path: '/api/items/:id/favourite', account: approved },
  itemImages: { method: GET, path: '/api/items/:id/images', account: owner },
  itemImage: { method: GET, path: '/api/items/:id/images/:kind', account: approved },
  chooseItemImage: { method: PUT, path: '/api/items/:id/images/:kind', account: owner },
  itemLocalImage: { method: GET, path: '/api/items/:id/images/:kind/local', account: approved },
  matchItem: { method: PUT, path: '/api/items/:id/match', account: owner },
  itemMetadata: { method: GET, path: '/api/items/:id/metadata', account: owner },
  editItemMetadata: { method: PUT, path: '/api/items/:id/metadata', account: owner },
  nextEpisode: { method: GET, path: '/api/items/:id/next', account: approved },
  refreshItem: { method: POST, path: '/api/items/:id/refresh', account: owner },
  shuffle: { method: GET, path: '/api/items/:id/shuffle', account: approved },
  libraries: { method: GET, path: '/api/libraries', account: approved },
  createLibrary: { method: POST, path: '/api/libraries', account: owner },
  library: { method: GET, path: '/api/libraries/:id', account: approved },
  reorderLibraries: { method: PUT, path: '/api/libraries/order', account: owner },
  setLibraryInHero: { method: PUT, path: '/api/libraries/:id/hero', account: owner },
  updateLibrary: { method: PUT, path: '/api/libraries/:id', account: owner },
  deleteLibrary: { method: DELETE, path: '/api/libraries/:id', account: owner },
  duplicates: { method: GET, path: '/api/libraries/:id/duplicates', account: approved },
  joinDuplicates: { method: POST, path: '/api/libraries/:id/duplicates/join', account: owner },
  splitDuplicates: { method: POST, path: '/api/libraries/:id/duplicates/split', account: owner },
  libraryFavourites: { method: GET, path: '/api/libraries/:id/favourites', account: approved },
  history: { method: GET, path: '/api/libraries/:id/history', account: approved },
  inProgress: { method: GET, path: '/api/libraries/:id/in-progress', account: approved },
  matchLibrary: { method: POST, path: '/api/libraries/:id/match', account: owner },
  libraryMedia: { method: GET, path: '/api/libraries/:id/media', account: approved },
  quickScan: { method: POST, path: '/api/libraries/:id/quick-scan', account: owner },
  updateRatings: { method: POST, path: '/api/libraries/:id/ratings', account: owner },
  sagas: { method: GET, path: '/api/libraries/:id/sagas', account: approved },
  sagaBackdrop: {
    method: PUT,
    path: '/api/libraries/:id/sagas/:sagaId/backdrop',
    account: owner,
  },
  scan: { method: POST, path: '/api/libraries/:id/scan', account: owner },
  cancelScan: { method: POST, path: '/api/libraries/:id/scan/cancel', account: owner },
  cancelQuickScan: { method: POST, path: '/api/libraries/:id/quick-scan/cancel', account: owner },
  cancelRatings: { method: POST, path: '/api/libraries/:id/ratings/cancel', account: owner },
  shows: { method: GET, path: '/api/libraries/:id/shows', account: approved },
  unmatched: { method: GET, path: '/api/libraries/:id/unmatched', account: approved },
  libraryView: { method: PUT, path: '/api/libraries/:id/view', account: approved },
  lockState: { method: GET, path: '/api/lock', account: approved },
  relock: { method: POST, path: '/api/lock/lock', account: approved },
  unlock: { method: POST, path: '/api/lock/unlock', account: approved },
  matchSearch: { method: GET, path: '/api/match/search', account: owner },
  me: { method: GET, path: AUTH_PATHS.me, account: session },
  mediaOrigins: { method: GET, path: '/api/media-origins', account: approved },
  ping: { method: GET, path: '/api/media-origins/ping', account: anyone },
  media: { method: GET, path: '/api/media/:id', account: approved },
  deleteMedia: { method: DELETE, path: '/api/media/:id', account: owner },
  mediaFavourite: { method: PUT, path: '/api/media/:id/favourite', account: approved },
  file: { method: GET, path: '/api/media/:id/file', account: approved },
  hlsMaster: { method: GET, path: HLS_PATHS.master, account: approved },
  hlsVideo: { method: GET, path: HLS_PATHS.video, account: approved },
  hlsInit: { method: GET, path: HLS_PATHS.init, account: approved },
  hlsSegment: { method: GET, path: HLS_PATHS.segment, account: approved },
  hlsSubtitles: { method: GET, path: HLS_PATHS.subtitles, account: approved },
  hlsSubtitleSegment: { method: GET, path: HLS_PATHS.subtitleSegment, account: approved },
  location: { method: GET, path: '/api/media/:id/location', account: owner },
  matchMedia: { method: PUT, path: '/api/media/:id/match', account: owner },
  plays: { method: POST, path: '/api/media/:id/plays', account: approved },
  progress: { method: PUT, path: '/api/media/:id/progress', account: approved },
  stream: { method: GET, path: '/api/media/:id/stream', account: approved },
  mediaStreams: { method: GET, path: '/api/media/:id/streams', account: approved },
  subtitles: { method: GET, path: '/api/media/:id/subtitles/:trackId', account: approved },
  thumbnail: { method: GET, path: '/api/media/:id/thumbnail', account: approved },
  mediaTicket: { method: GET, path: '/api/media/:id/ticket', account: approved },
  tracks: { method: GET, path: '/api/media/:id/tracks', account: approved },
  person: { method: GET, path: '/api/people/:id', account: approved },
  itemPicture: { method: GET, path: PICTURE_PATHS.item, account: anyone },
  photoPicture: { method: GET, path: PICTURE_PATHS.photo, account: anyone },
  personPhoto: { method: GET, path: '/api/people/:id/photo', account: approved },
  reviewAvatar: { method: GET, path: '/api/reviews/:id/avatar', account: approved },
  reportError: { method: POST, path: BUG_REPORT_PATHS.reports, account: approved },
  bugReports: { method: GET, path: BUG_REPORT_PATHS.reports, account: owner },
  bugReportStatus: { method: PUT, path: BUG_REPORT_PATHS.status, account: owner },
  displaySettings: { method: GET, path: '/api/settings/display', account: approved },
  saveDisplaySettings: { method: PUT, path: '/api/settings/display', account: owner },
  playbackSettings: { method: GET, path: '/api/settings/playback', account: approved },
  savePlaybackSettings: { method: PUT, path: '/api/settings/playback', account: owner },
  streams: { method: GET, path: '/api/streams', account: owner },
  stopStream: { method: POST, path: '/api/streams/:id/stop', account: owner },
  watched: { method: PUT, path: '/api/watched', account: approved },
} as const

export type Route = (typeof ROUTES)[keyof typeof ROUTES]

/**
 * The routes an HLS session's capability opens, under accounts `ready`, in
 * place of an account ticket: every one that names the session.
 */
export const HLS_CAPABILITY_ROUTES = [
  ROUTES.hlsVideo,
  ROUTES.hlsInit,
  ROUTES.hlsSegment,
  ROUTES.hlsSubtitles,
  ROUTES.hlsSubtitleSegment,
] as const satisfies readonly Route[]

type PathOfProps = {
  route: Route
  params?: Record<string, number | string>
}

/** `path` with each `:name` filled from `params`, else with `1`. */
export const pathOf = ({ route, params = {} }: PathOfProps): string =>
  route.path
    .split('/')
    .map((segment) => (segment.startsWith(':') ? String(params[segment.slice(1)] ?? 1) : segment))
    .join('/')

type WithTicketProps = {
  route: Route
  params?: Record<string, number | string>
  ticket: string
}

/** `route`'s path with a media ticket in `?t=`, as the media plane is asked for it. */
export const withTicket = ({ route, params, ticket }: WithTicketProps): string =>
  `${pathOf({ route, params })}?${MEDIA_TICKET_PARAM}=${ticket}`

/** The session the first video playlist URI in `text` names, or '' when it names none. */
export const hlsSessionIn = (text: string): string => {
  const pattern = HLS_PATHS.video
    .replace('.', '\\.')
    .replace(`:${HLS_PARAMS.id}`, '\\d+')
    .replace(`:${HLS_PARAMS.session}`, '([A-Za-z0-9_-]+)')
  return new RegExp(pattern).exec(text)?.[1] ?? ''
}

/** Who a request comes from, by the account its token names, or none. */
export const CALLER_KINDS = {
  anonymous: 'anonymous',
  unverified: 'unverified',
  pending: 'pending',
  revoked: 'revoked',
  member: 'member',
  guest: 'guest',
  owner: 'owner',
} as const

export type CallerKind = (typeof CALLER_KINDS)[keyof typeof CALLER_KINDS]

/** How a caller's token travels: the Authorization header, or the web's session cookie. */
export const TOKEN_CARRIERS = { bearer: 'bearer', cookie: 'cookie' } as const

const CALLER_IDS = {
  [CALLER_KINDS.unverified]: AUTH_TEST_IDS.missing,
  [CALLER_KINDS.pending]: AUTH_TEST_IDS.pending,
  [CALLER_KINDS.revoked]: AUTH_TEST_IDS.revoked,
  [CALLER_KINDS.member]: AUTH_TEST_IDS.friend,
  [CALLER_KINDS.guest]: AUTH_TEST_IDS.guest,
  [CALLER_KINDS.owner]: AUTH_TEST_IDS.owner,
} as const

type AuthFixture = Awaited<ReturnType<typeof authFixture>>

type HeadersForProps = {
  fixture: AuthFixture
  caller: CallerKind
  via: (typeof TOKEN_CARRIERS)[keyof typeof TOKEN_CARRIERS]
}

/** The headers `caller` sends, with a freshly minted token carried `via` Bearer or the cookie. */
export const headersFor = async ({
  fixture,
  caller,
  via,
}: HeadersForProps): Promise<Record<string, string>> => {
  if (caller === CALLER_KINDS.anonymous) return {}
  const token = await fixture.mint({ id: CALLER_IDS[caller] })
  return via === TOKEN_CARRIERS.bearer
    ? bearerHeaders({ token })
    : { [AUTH_HEADERS.cookie]: authCookie({ token }) }
}

/** An injected response, as far as `outcomeOf` reads it. */
type Answered = {
  statusCode: number
  headers: Record<string, unknown>
  body: string
  json: () => unknown
}

type OutcomeOfProps = {
  response: Answered
}

/** What a response says about who may have it: its status, its refusal, and how it may be cached. */
export const outcomeOf = ({
  response,
}: OutcomeOfProps): {
  status: number
  reason: string | null
  isVariedByAccount: boolean
  isNoStore: boolean
} => {
  const isJson = String(response.headers[HEADERS.contentType] ?? '').startsWith(CONTENT_TYPES.json)
  const body: unknown = isJson && response.body !== '' ? response.json() : null
  const vary = String(response.headers[HEADERS.vary] ?? '')
  return {
    status: response.statusCode,
    reason: isAuthRefusal(body) ? body.reason : null,
    isVariedByAccount:
      vary.includes(AUTH_HEADERS.authorization) && vary.includes(AUTH_HEADERS.cookie),
    isNoStore: response.headers[HEADERS.cacheControl] === CACHE_POLICIES.noStore,
  }
}

const MATRIX = { id: 603, title: 'The Matrix', released: '1999-03-31' } as const

const ANDOR: FakeShow = {
  id: 83867,
  title: 'Andor',
  first: '2022-09-21',
  seasons: {
    1: [
      { number: 1, title: 'Kassa', aired: '2022-09-21' },
      { number: 2, title: 'That Would Be Me', aired: '2022-09-21' },
    ],
  },
}

/** What the fake TMDB knows: The Matrix, and the first two episodes of Andor. */
export const ENFORCED_TITLES = { movies: [MATRIX], shows: [ANDOR] }

type CreateEnforcedAppProps = {
  root: string
  fixture: AuthFixture
  libraryPin?: string | null
  /** RAVEN_MEDIA_SECRET, for a test that needs a legacy ticket to offer. */
  mediaSecret?: Buffer | null
  /** RAVEN_MEDIA_ORIGINS, as the server reads them. */
  mediaOrigins?: readonly MediaOrigin[]
  /** How often open SSE and media responses are checked again; a minute when left out. */
  accessRecheckMs?: number
  /** How long The Matrix runs, for a test that saves a spot further in than a second. */
  movieSeconds?: number
}

/**
 * A server with accounts `ready`, on which the owner has made and scanned
 * one movies library holding The Matrix, matched against a fake TMDB. The
 * owner manages by Bearer alone; no admin cookie is involved.
 */
export const createEnforcedApp = async ({
  root,
  fixture,
  libraryPin = null,
  mediaSecret = null,
  mediaOrigins = [],
  accessRecheckMs,
  movieSeconds = 1,
}: CreateEnforcedAppProps): Promise<{
  app: NestFastifyApplication
  mediaDir: string
  ownerApi: ApiClient
  ids: { library: number; video: number; item: number | null }
}> => {
  const mediaDir = join(root, 'media')
  await encodeClip({ path: join(mediaDir, 'The Matrix (1999).mp4'), seconds: movieSeconds })
  const base = testConfig({ dataDir: join(root, 'data'), mediaDir })
  const app = await createApp({
    config: {
      ...base,
      mediaPlane: { ...base.mediaPlane, origins: [...mediaOrigins], secret: mediaSecret },
      auth: AUTH_TEST_CONFIG,
      libraryPin,
      tmdbApiToken: 'test-token',
    },
    authKeys: fixture.keys,
    authFetch: fixture.fetcher,
    metadataFetch: fakeTmdb(ENFORCED_TITLES).fetch,
    quiet: true,
    watch: NOT_WATCHING,
    accessRecheckMs,
  })
  await app.init()
  await app.getHttpAdapter().getInstance().ready()
  const ownerToken = await fixture.mint({ id: AUTH_TEST_IDS.owner })
  const ownerApi = createApiClient({
    fetch: injectFetch({ app }),
    accessToken: () => ownerToken,
  })
  const library = await ownerApi.createLibrary({
    name: 'Enforced',
    paths: [mediaDir],
    settings: { kind: LIBRARY_KINDS.movies },
  })
  await app.get(ScannerService).whenIdle(library.id)
  await app.get(MetadataService).whenIdle()
  await app.get(ThumbnailService).whenIdle()
  const video = (await ownerApi.listMedia({ libraryId: library.id }))[0]
  if (video === undefined) throw new Error('The enforced library scanned no video')
  const item =
    app.get(MetadataRepository).find({ type: ITEM_TYPES.movie, tmdbId: String(MATRIX.id) })?.id ??
    null
  return { app, mediaDir, ownerApi, ids: { library: library.id, video: video.id, item } }
}

/** Where `addShow` finds Andor's season, and its two episodes in order. */
export type ShowIds = { library: number; show: number; season: number; episodes: [number, number] }

type AddShowProps = {
  root: string
  enforced: Pick<Awaited<ReturnType<typeof createEnforcedApp>>, 'app' | 'ownerApi'>
}

/**
 * Adds a shows library holding the first two episodes of Andor, matched
 * against the fake TMDB, to a server `createEnforcedApp` made. It is a
 * separate step because the other suites count the one library that
 * function leaves.
 */
export const addShow = async ({ root, enforced }: AddShowProps): Promise<ShowIds> => {
  const { app, ownerApi } = enforced
  const showsDir = join(root, 'shows')
  const season = join(showsDir, 'Andor (2022)', 'Season 01')
  const first = join(season, 'Andor - S01E01 - Kassa.mp4')
  await encodeClip({ path: first, seconds: 1 })
  await copyFile(first, join(season, 'Andor - S01E02 - That Would Be Me.mp4'))
  const library = await ownerApi.createLibrary({
    name: 'Shows',
    paths: [showsDir],
    settings: { kind: LIBRARY_KINDS.shows },
  })
  await app.get(ScannerService).whenIdle(library.id)
  await app.get(MetadataService).whenIdle()
  await app.get(ThumbnailService).whenIdle()
  const { shows } = await ownerApi.listShows({ libraryId: library.id })
  const [entry] = shows
  if (entry === undefined) throw new Error('The enforced shows library matched no show')
  const [firstSeason] = (await ownerApi.getItem(entry.show.id)).children
  const [one, two] = (await ownerApi.listMedia({ libraryId: library.id }))
    .toSorted((a, b) => a.fileName.localeCompare(b.fileName))
    .map(({ id }) => id)
  if (firstSeason === undefined || one === undefined || two === undefined) {
    throw new Error('The enforced shows library did not match Andor and its two episodes')
  }
  return { library: library.id, show: entry.show.id, season: firstSeason.id, episodes: [one, two] }
}

/** The movies library's two extras: a file no movie matches, and a second file of The Matrix. */
export type LeftoverIds = { unmatched: number; duplicate: number }

const LEFTOVER_FILES = {
  unmatched: 'Zzxq Qwvb Unmatchable.mp4',
  duplicate: 'The Matrix (1999) Final Cut.mp4',
} as const

type AddLeftoversProps = {
  enforced: Pick<
    Awaited<ReturnType<typeof createEnforcedApp>>,
    'app' | 'mediaDir' | 'ownerApi' | 'ids'
  >
}

/**
 * Adds to the movies library `createEnforcedApp` made a file the fake TMDB
 * cannot match and a second file of The Matrix, so Not matched and Duplicates
 * have something to list. A separate step for the same reason as `addShow`.
 */
export const addLeftovers = async ({ enforced }: AddLeftoversProps): Promise<LeftoverIds> => {
  const { app, mediaDir, ownerApi, ids } = enforced
  const matrix = join(mediaDir, 'The Matrix (1999).mp4')
  await Promise.all(
    Object.values(LEFTOVER_FILES).map((name) => copyFile(matrix, join(mediaDir, name))),
  )
  await ownerApi.scanLibrary(ids.library)
  await app.get(ScannerService).whenIdle(ids.library)
  await app.get(MetadataService).whenIdle()
  await app.get(ThumbnailService).whenIdle()
  const unmatched = (await ownerApi.listUnmatched(ids.library)).find(
    ({ fileName }) => fileName === LEFTOVER_FILES.unmatched,
  )
  const duplicate = (await ownerApi.listDuplicates(ids.library))
    .flatMap(({ cards }) => cards.flatMap(({ files }) => files))
    .find(({ media }) => media.fileName === LEFTOVER_FILES.duplicate)
  if (unmatched === undefined || duplicate === undefined) {
    throw new Error('The enforced movies library did not list its extra files')
  }
  return { unmatched: unmatched.id, duplicate: duplicate.media.id }
}
