import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { NestFastifyApplication } from '@nestjs/platform-fastify'
import {
  type ApiClient,
  AUTH_REFUSALS,
  BUG_REPORT_PARAMS,
  BUG_REPORT_PATHS,
  BUG_REPORT_STATUSES,
  MAX_BUG_REPORT_BYTES,
  MEDIA_ORIGIN_KINDS,
  PLAYBACK_MODES,
  type PlaybackDiagnostics,
  createApiClient,
} from '@raven/core'
import { CACHE_POLICIES, HEADERS } from '@shared/server'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createApp } from '@/app'
import { DatabaseService } from '@/db/database'
import { VIEWING_ACCOUNTS } from '@/media/viewingAccountKeys'
import { MAX_REPORTS_PER_WINDOW } from '@/reports/bugReportsController'
import { NOT_WATCHING, adminCookie, injectAs, testConfig } from '@/test/app'
import { AUTH_TEST_CONFIG, AUTH_TEST_IDS, authFixture, bearerHeaders } from '@/test/auth'
import { apiFor, injectFetch } from '@/test/server'

const diagnostics = (overrides: Partial<PlaybackDiagnostics> = {}): PlaybackDiagnostics => ({
  title: 'Busboys (2026)',
  problems: ['The converted video stopped.', "HEVC video isn't supported here."],
  media: {
    id: 7,
    libraryId: 2,
    fileName: 'Busboys (2026) 2160p.mkv',
    container: 'mkv',
    size: 1_609_721_462,
    duration: 5812.768,
    width: 3840,
    height: 2160,
    videoCodec: 'hevc',
    videoBitDepth: 10,
    hdr: true,
    audioCodec: 'eac3',
    audioChannels: 6,
    bitrate: 24_200_000,
  },
  tracks: { audio: null, subtitle: null, audioCount: 1, subtitleCount: 0 },
  playback: {
    modes: [PLAYBACK_MODES.remux, PLAYBACK_MODES.transcode],
    attempts: [
      {
        mode: PLAYBACK_MODES.transcode,
        message: 'The converted video stopped.',
        position: 61.5,
        frame: { width: 1920, height: 1080 },
        frames: { dropped: 3, total: 1400 },
      },
    ],
    isForced: false,
    steppedDown: null,
    settings: null,
  },
  position: { resumeAt: 0, failedAt: 61.5 },
  support: { play: [], stream: [], hasMediaSource: true, hasManagedMediaSource: false },
  origin: {
    kind: MEDIA_ORIGIN_KINDS.lan,
    url: 'https://raven.home.example.com',
    pickedAt: '2026-10-20T11:59:00Z',
  },
  isProbingOrigins: false,
  device: {
    userAgent: 'Mozilla/5.0 (Macintosh) Safari/605.1.15',
    brands: null,
    isMobile: null,
    platform: null,
    language: 'en-GB',
    languages: ['en-GB'],
    screen: { width: 1512, height: 982 },
    viewport: { width: 1512, height: 860 },
    pixelRatio: 2,
    cores: 10,
    memory: null,
    connection: null,
    isOnline: true,
    timeZone: 'Europe/London',
  },
  app: { version: '0.7.0', page: 'https://raven.example.com/watch/7' },
  reportedAt: '2026-10-20T12:00:00.000Z',
  ...overrides,
})

describe('bug reports on a server without accounts', () => {
  const state: { root: string; admin: string; app: NestFastifyApplication | null } = {
    root: '',
    admin: '',
    app: null,
  }
  const app = (): NestFastifyApplication => {
    if (!state.app) throw new Error('app not started')
    return state.app
  }
  /** A browser with the admin lock off, and one with it on, as any viewer's is. */
  const admin = (): ApiClient => apiFor({ app: app(), cookie: state.admin })
  const viewer = (): ApiClient => apiFor({ app: app() })
  const post = (payload: Record<string, unknown>) =>
    app().inject({ method: 'POST', url: BUG_REPORT_PATHS.reports, payload })

  beforeAll(async () => {
    state.root = await mkdtemp(join(tmpdir(), 'raven-reports-'))
    state.app = await createApp({
      config: testConfig({ dataDir: join(state.root, 'data'), mediaDir: state.root }),
      quiet: true,
    })
    await state.app.init()
    await state.app.getHttpAdapter().getInstance().ready()
    state.admin = await adminCookie(state.app)
  })

  afterEach(() => {
    app().get(DatabaseService).db.prepare('DELETE FROM bug_reports').run()
  })

  afterAll(async () => {
    await state.app?.close()
    await rm(state.root, { recursive: true, force: true, maxRetries: 5 })
  })

  it('keeps a viewer’s report as new, under the shared account, with its first problem', async () => {
    const sent = await viewer().reportPlaybackError(diagnostics())
    expect(sent).toMatchObject({
      status: BUG_REPORT_STATUSES.new,
      reporter: { accountId: VIEWING_ACCOUNTS.local, email: null },
      title: 'Busboys (2026)',
      summary: 'The converted video stopped.',
      mediaId: 7,
    })
    expect(await admin().listBugReports()).toEqual([{ ...sent, diagnostics: diagnostics() }])
  })

  it('lists the newest first', async () => {
    await viewer().reportPlaybackError(diagnostics({ title: 'First' }))
    await viewer().reportPlaybackError(diagnostics({ title: 'Second', media: null }))
    const listed = await admin().listBugReports()
    expect(listed.map(({ title, mediaId }) => [title, mediaId])).toEqual([
      ['Second', null],
      ['First', 7],
    ])
  })

  it('keeps no ticket, on the page, the origin or quoted in a problem', async () => {
    await viewer().reportPlaybackError(
      diagnostics({
        problems: ['GET https://raven.home.example.com/api/media/7/file?t=account.secret failed'],
        app: { version: null, page: 'https://raven.example.com/watch/7?t=account.secret#x' },
        origin: {
          kind: MEDIA_ORIGIN_KINDS.lan,
          url: 'https://raven.home.example.com?t=secret',
          pickedAt: 'now',
        },
      }),
    )
    const [report] = await admin().listBugReports()
    expect(JSON.stringify(report)).not.toContain('secret')
    expect(report?.diagnostics ?? null).toMatchObject({
      problems: ['GET https://raven.home.example.com/api/media/7/file?t=redacted failed'],
      app: { page: 'https://raven.example.com/watch/7' },
      origin: { url: 'https://raven.home.example.com' },
    })
  })

  it('refuses a body that is not diagnostics, and one too large to keep', async () => {
    expect((await post({ title: 'Broken' })).statusCode).toBe(400)
    expect((await post({ ...diagnostics(), problems: 'it broke' })).statusCode).toBe(400)
    const heavy = diagnostics({ problems: ['x'.repeat(MAX_BUG_REPORT_BYTES)] })
    expect((await post(heavy)).statusCode).toBe(413)
    expect(await admin().listBugReports()).toEqual([])
  })

  it('holds back an account that sends too many in an hour', async () => {
    await Promise.all(
      Array.from({ length: MAX_REPORTS_PER_WINDOW }, () =>
        viewer().reportPlaybackError(diagnostics()),
      ),
    )
    await expect(viewer().reportPlaybackError(diagnostics())).rejects.toMatchObject({
      status: 429,
    })
    expect(await admin().listBugReports()).toHaveLength(MAX_REPORTS_PER_WINDOW)
  })

  it('lists and changes status for the admin alone, never cached', async () => {
    const sent = await viewer().reportPlaybackError(diagnostics())
    await expect(viewer().listBugReports()).rejects.toMatchObject({ status: 403 })
    await expect(
      viewer().setBugReportStatus({ id: sent.id, status: BUG_REPORT_STATUSES.fixed }),
    ).rejects.toMatchObject({ status: 403 })
    const listed = await injectAs({ app: app(), cookie: state.admin })({
      method: 'GET',
      url: BUG_REPORT_PATHS.reports,
    })
    expect(listed.headers[HEADERS.cacheControl]).toBe(CACHE_POLICIES.noStore)

    const changed = await admin().setBugReportStatus({
      id: sent.id,
      status: BUG_REPORT_STATUSES.investigating,
    })
    expect(changed).toMatchObject({ id: sent.id, status: BUG_REPORT_STATUSES.investigating })
    expect((await admin().listBugReports())[0]?.status ?? null).toBe(
      BUG_REPORT_STATUSES.investigating,
    )
  })

  it('refuses a status a report cannot have, and a report that is not there', async () => {
    const sent = await viewer().reportPlaybackError(diagnostics())
    const put = injectAs({ app: app(), cookie: state.admin })
    const unknown = await put({
      method: 'PUT',
      url: BUG_REPORT_PATHS.status.replace(`:${BUG_REPORT_PARAMS.id}`, String(sent.id)),
      payload: { status: 'closed' },
    })
    expect(unknown.statusCode).toBe(400)
    await expect(
      admin().setBugReportStatus({ id: sent.id + 100, status: BUG_REPORT_STATUSES.fixed }),
    ).rejects.toMatchObject({ status: 404 })
    expect((await admin().listBugReports())[0]?.status ?? null).toBe(BUG_REPORT_STATUSES.new)
  })
})

describe('bug reports on a server with accounts', () => {
  const state: {
    root: string
    app: NestFastifyApplication | null
    fixture: Awaited<ReturnType<typeof authFixture>> | null
  } = { root: '', app: null, fixture: null }
  const app = (): NestFastifyApplication => {
    if (!state.app) throw new Error('app not started')
    return state.app
  }
  const tokenFor = async (id: string): Promise<string> => {
    if (!state.fixture) throw new Error('no fixture')
    return state.fixture.mint({ id })
  }
  const as = async (id: string): Promise<ApiClient> => {
    const token = await tokenFor(id)
    return createApiClient({ fetch: injectFetch({ app: app() }), accessToken: () => token })
  }

  beforeAll(async () => {
    state.root = await mkdtemp(join(tmpdir(), 'raven-reports-accounts-'))
    state.fixture = await authFixture()
    state.app = await createApp({
      config: {
        ...testConfig({ dataDir: join(state.root, 'data'), mediaDir: state.root }),
        auth: AUTH_TEST_CONFIG,
      },
      authKeys: state.fixture.keys,
      authFetch: state.fixture.fetcher,
      quiet: true,
      watch: NOT_WATCHING,
    })
    await state.app.init()
    await state.app.getHttpAdapter().getInstance().ready()
  })

  beforeEach(() => {
    state.fixture?.fetcher.mockClear()
  })

  afterAll(async () => {
    await state.app?.close()
    await rm(state.root, { recursive: true, force: true, maxRetries: 5 })
  })

  it('files a member’s report under the member’s own account, whatever the body says', async () => {
    const member = await as(AUTH_TEST_IDS.friend)
    const forged = { ...diagnostics(), accountId: AUTH_TEST_IDS.owner, reporter: 'owner' }
    const response = await app().inject({
      method: 'POST',
      url: BUG_REPORT_PATHS.reports,
      payload: forged,
      headers: bearerHeaders({ token: await tokenFor(AUTH_TEST_IDS.friend) }),
    })
    expect(response.statusCode).toBe(201)
    await member.reportPlaybackError(diagnostics())

    const owner = await as(AUTH_TEST_IDS.owner)
    const listed = await owner.listBugReports()
    expect(listed.map(({ reporter }) => reporter)).toEqual([
      { accountId: AUTH_TEST_IDS.friend, email: 'friend@maester.test' },
      { accountId: AUTH_TEST_IDS.friend, email: 'friend@maester.test' },
    ])
    await expect(member.listBugReports()).rejects.toMatchObject({
      status: 403,
      refusal: { reason: AUTH_REFUSALS.notOwner },
    })
  })
})
