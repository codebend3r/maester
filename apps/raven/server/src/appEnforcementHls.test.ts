import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Logger } from '@nestjs/common'
import {
  HLS_PARAMS,
  HLS_PATHS,
  MEDIA_TICKET_PARAM,
  MEMBER_STATUSES,
  PLAYBACK_MODES,
  SUBTITLE_SOURCES,
  isMediaTicket,
  toQueryString,
} from '@raven/core'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { HLS_CAPABILITY_PREFIX } from '@/hls/hlsCapability'
import { eventually, routePath } from '@/test/app'
import { AUTH_TEST_FAILURES, AUTH_TEST_IDS, authFixture } from '@/test/auth'
import {
  CALLER_KINDS,
  type CallerKind,
  ROUTES,
  TOKEN_CARRIERS,
  addLeftovers,
  createEnforcedApp,
  headersFor,
  hlsSessionIn,
  pathOf,
} from '@/test/enforced'

describe("an account's HLS session", () => {
  const RECHECK_MS = 100
  /** Several rechecks long, and the bound a test holds the server to. */
  const ENDED_WITHIN_MS = 1_000
  const SUBRIP = ['1', '00:00:00,200 --> 00:00:00,900', 'Wake up, Neo.', ''].join('\n')
  /** Any URL base, to read a URI's path and query with `URL`. */
  const BASE = 'http://raven.test'
  const LOG_METHODS = ['log', 'warn', 'error', 'debug', 'verbose', 'fatal'] as const
  const CONSOLE_METHODS = ['log', 'info', 'warn', 'error', 'debug'] as const

  let fixture: Awaited<ReturnType<typeof authFixture>>
  let plane: Awaited<ReturnType<typeof createEnforcedApp>>
  let root: string
  /** Each video's sidecar track, by media id. */
  const sidecars = new Map<number, string>()
  let other: number

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'raven-enforcement-hls-'))
    fixture = await authFixture()
    plane = await createEnforcedApp({ root, fixture, accessRecheckMs: RECHECK_MS })
    other = (await addLeftovers({ enforced: plane })).duplicate
    await Promise.all(
      ['The Matrix (1999).en.srt', 'The Matrix (1999) Final Cut.en.srt'].map((name) =>
        writeFile(join(plane.mediaDir, name), SUBRIP),
      ),
    )
    await Promise.all(
      [plane.ids.video, other].map(async (id) => {
        const { subtitles } = await plane.ownerApi.getTracks(id)
        const track = subtitles.find(({ source }) => source === SUBTITLE_SOURCES.external)
        sidecars.set(id, track?.id ?? '')
      }),
    )
  })

  afterAll(async () => {
    await plane.app.close()
    await rm(root, { recursive: true, force: true, maxRetries: 5 })
  })

  const get = ({ url, headers = {} }: { url: string; headers?: Record<string, string> }) =>
    plane.app.inject({ url, headers })

  const ticketFor = async ({ caller, id }: { caller: CallerKind; id: number }) => {
    const response = await plane.app.inject({
      method: ROUTES.accountTicket.method,
      url: pathOf({ route: ROUTES.accountTicket, params: { id } }),
      headers: await headersFor({ fixture, caller, via: TOKEN_CARRIERS.bearer }),
    })
    const body: unknown = response.json()
    if (!isMediaTicket(body)) throw new Error('No ticket was minted')
    return body.ticket
  }

  /** The URIs a playlist names on lines of their own: a master's variant, a media playlist's segments. */
  const linesIn = (playlist: string): string[] =>
    playlist.split('\n').filter((line) => line.trim() !== '' && !line.startsWith('#'))

  /** The URIs a playlist's tags name: a master's renditions, a media playlist's init. */
  const attributesIn = (playlist: string): string[] =>
    [...playlist.matchAll(/URI="([^"]+)"/g)].flatMap((match) => match[1] ?? [])

  const urisIn = (playlist: string): string[] => [...linesIn(playlist), ...attributesIn(playlist)]

  const keyOf = (uri: string): string | null =>
    new URL(uri, BASE).searchParams.get(MEDIA_TICKET_PARAM)

  type Opened = {
    id: number
    session: string
    ticket: string
    capability: string
    /** Every URI the master, video and subtitle playlists named. */
    named: string[]
  }

  /** Opens a remux of `id` with an account ticket alone, as a native player does. */
  const open = async ({ caller, id }: { caller: CallerKind; id: number }): Promise<Opened> => {
    const ticket = await ticketFor({ caller, id })
    const query = toQueryString({
      [HLS_PARAMS.mode]: PLAYBACK_MODES.remux,
      [MEDIA_TICKET_PARAM]: ticket,
    })
    const master = await get({
      url: `${pathOf({ route: ROUTES.hlsMaster, params: { id } })}?${query}`,
    })
    expect(master.statusCode).toBe(200)
    const [variant = ''] = linesIn(master.body)
    const subtitles = attributesIn(master.body)
    const playlists = await Promise.all([variant, ...subtitles].map((url) => get({ url })))
    playlists.forEach((response) => expect(response.statusCode).toBe(200))
    const named = [
      ...urisIn(master.body),
      ...playlists.flatMap((response) => urisIn(response.body)),
    ]
    return {
      id,
      session: hlsSessionIn(variant),
      ticket,
      capability: keyOf(variant) ?? '',
      named,
    }
  }

  /** The five routes a session's capability opens, for `session` of media `id`, carrying `key`. */
  const sessionRoutes = ({
    id,
    session,
    key,
  }: {
    id: number
    session: string
    key: string | null
  }): string[] =>
    [
      HLS_PATHS.video,
      HLS_PATHS.init,
      HLS_PATHS.segment,
      HLS_PATHS.subtitles,
      HLS_PATHS.subtitleSegment,
    ]
      .map((route) =>
        routePath({
          route,
          values: {
            [HLS_PARAMS.id]: id,
            [HLS_PARAMS.session]: session,
            [HLS_PARAMS.trackId]: sidecars.get(id) ?? '',
            [HLS_PARAMS.n]: 0,
          },
        }),
      )
      .map((path) =>
        key === null ? path : `${path}?${toQueryString({ [MEDIA_TICKET_PARAM]: key })}`,
      )

  const statusesOf = async ({
    urls,
    headers,
  }: {
    urls: string[]
    headers?: Record<string, string>
  }): Promise<number[]> =>
    Promise.all(urls.map(async (url) => (await get({ url, headers })).statusCode))

  const setStatus = ({
    id,
    status,
  }: {
    id: string
    status: typeof MEMBER_STATUSES.approved | typeof MEMBER_STATUSES.revoked
  }) => plane.ownerApi.setMemberStatus({ id, change: { status } })

  it('names its own capability on every URI, never the ticket, and plays on it alone', async () => {
    const first = await open({ caller: CALLER_KINDS.member, id: plane.ids.video })
    const second = await open({ caller: CALLER_KINDS.member, id: plane.ids.video })
    expect(first.capability.startsWith(HLS_CAPABILITY_PREFIX)).toBe(true)
    expect(first.capability).not.toBe(second.capability)
    expect(first.named.length).toBeGreaterThan(3)
    expect(first.named.map(keyOf)).toEqual(first.named.map(() => first.capability))
    expect(first.named.join('\n')).not.toContain(first.ticket)
    expect(
      await statusesOf({
        urls: sessionRoutes({ id: first.id, session: first.session, key: first.capability }),
      }),
    ).toEqual([200, 200, 200, 200, 200])
  })

  it("opens nothing of another account's session or another media with it", async () => {
    const mine = await open({ caller: CALLER_KINDS.member, id: plane.ids.video })
    const theirs = await open({ caller: CALLER_KINDS.guest, id: other })
    const forged = `${HLS_CAPABILITY_PREFIX}${'A'.repeat(43)}`
    const refused = await Promise.all(
      [
        sessionRoutes({ id: theirs.id, session: theirs.session, key: mine.capability }),
        sessionRoutes({ id: mine.id, session: mine.session, key: theirs.capability }),
        sessionRoutes({ id: other, session: mine.session, key: mine.capability }),
        sessionRoutes({ id: mine.id, session: mine.session, key: forged }),
      ].map((urls) => statusesOf({ urls })),
    )
    expect(refused).toEqual(refused.map(() => [404, 404, 404, 404, 404]))
    expect(
      await statusesOf({
        urls: sessionRoutes({ id: theirs.id, session: theirs.session, key: theirs.capability }),
      }),
    ).toEqual([200, 200, 200, 200, 200])
  })

  it('refuses an account ticket or a Bearer on its routes once it has a capability', async () => {
    const opened = await open({ caller: CALLER_KINDS.member, id: plane.ids.video })
    const ticket = await ticketFor({ caller: CALLER_KINDS.member, id: plane.ids.video })
    const withTicket = await statusesOf({
      urls: sessionRoutes({ id: opened.id, session: opened.session, key: ticket }),
    })
    const withBearer = await statusesOf({
      urls: sessionRoutes({ id: opened.id, session: opened.session, key: null }),
      headers: await headersFor({
        fixture,
        caller: CALLER_KINDS.member,
        via: TOKEN_CARRIERS.bearer,
      }),
    })
    expect({ withTicket, withBearer }).toEqual({
      withTicket: [404, 404, 404, 404, 404],
      withBearer: [404, 404, 404, 404, 404],
    })
  })

  it("ends the account's sessions within a recheck of its removal, and a new ticket opens again", async () => {
    const opened = await open({ caller: CALLER_KINDS.member, id: plane.ids.video })
    const [video = ''] = sessionRoutes({
      id: opened.id,
      session: opened.session,
      key: opened.capability,
    })
    await setStatus({ id: AUTH_TEST_IDS.friend, status: MEMBER_STATUSES.revoked })
    try {
      const started = Date.now()
      await eventually({
        read: async () => (await get({ url: video })).statusCode,
        check: (status) => status === 404,
        ms: ENDED_WITHIN_MS,
      })
      expect(Date.now() - started).toBeLessThan(ENDED_WITHIN_MS)
    } finally {
      await setStatus({ id: AUTH_TEST_IDS.friend, status: MEMBER_STATUSES.approved })
    }
    expect((await get({ url: video })).statusCode).toBe(404)
    const reopened = await open({ caller: CALLER_KINDS.member, id: plane.ids.video })
    expect(
      await statusesOf({
        urls: sessionRoutes({
          id: reopened.id,
          session: reopened.session,
          key: reopened.capability,
        }),
      }),
    ).toEqual([200, 200, 200, 200, 200])
  })

  it('puts the capability and the ticket in no log line', async () => {
    const logged = LOG_METHODS.map((method) =>
      vi.spyOn(Logger.prototype, method).mockImplementation(() => undefined),
    )
    const printed = CONSOLE_METHODS.map((method) =>
      vi.spyOn(console, method).mockImplementation(() => undefined),
    )
    try {
      const opened = await open({ caller: CALLER_KINDS.guest, id: plane.ids.video })
      const urls = sessionRoutes({ id: opened.id, session: opened.session, key: opened.capability })
      await statusesOf({ urls })
      await statusesOf({
        urls: sessionRoutes({ id: other, session: opened.session, key: opened.capability }),
      })
      const lines = () =>
        JSON.stringify([...logged, ...printed].flatMap((spy) => spy.mock.calls.flat().map(String)))
      // An outage makes the session's recheck warn, and keeps it.
      fixture.state.failure = AUTH_TEST_FAILURES.network
      try {
        await eventually({
          read: async () => lines(),
          check: (text) => text.includes('keeping it'),
        })
      } finally {
        fixture.state.failure = AUTH_TEST_FAILURES.none
      }
      expect(await statusesOf({ urls })).toEqual([200, 200, 200, 200, 200])
      await setStatus({ id: AUTH_TEST_IDS.guest, status: MEMBER_STATUSES.revoked })
      try {
        await eventually({
          read: async () => (await get({ url: urls[0] ?? '' })).statusCode,
          check: (status) => status === 404,
          ms: ENDED_WITHIN_MS,
        })
      } finally {
        await setStatus({ id: AUTH_TEST_IDS.guest, status: MEMBER_STATUSES.approved })
      }
      expect(lines()).toContain('keeping it')
      expect(lines()).not.toContain(opened.capability)
      expect(lines()).not.toContain(opened.ticket)
    } finally {
      ;[...logged, ...printed].forEach((spy) => spy.mockRestore())
    }
  })
})
