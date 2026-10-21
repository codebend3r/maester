import { describe, expect, it, spyOn } from 'bun:test'
import {
  ACCESS_REFUSALS,
  ACCOUNT_ACCESS_MESSAGES,
  APP_CLIENT_CALLS,
  AUTH_REFUSALS,
  AUTH_HEADERS,
  AUTH_SCHEME,
  HLS_PARAMS,
  HLS_PATHS,
  MEDIA_ORIGIN_KINDS,
  MEDIA_TICKET_PARAM,
  MEDIA_TICKET_RENEW_MS,
  MAX_HEIGHTS,
  type MaxHeight,
  PLAYBACK_MODES,
  SERVER_COOKIES,
  type StreamQuality,
  toQueryString,
} from '@raven/core'

import type { ServerCookies } from '@/servers/cookieJar'
import {
  MEDIA_ACCESS_MESSAGES,
  mediaAccessFor,
  type SourceOutcome,
  type SourceRequest,
} from '@/servers/mediaAccess'
import { STATUSES, pathFor } from '@/test/fixtureFetch'
import { NAS } from '@/test/homeServer'
import {
  ACCOUNT_TICKETS,
  ACCOUNT_TOKENS,
  LAN,
  NAS_COOKIES,
  PUBLIC,
  TICKETS,
  accountServer,
  fakeNetwork,
  mediaServer,
  probesOf,
} from '@/test/mediaServer'

const BUSBOYS = { id: 20 }
const READ_AT = 1_000_000
/** The sizes a cap asks a transcode for, typed so a name `STREAM_QUALITIES` lacks fails the check. */
const LOW_1080: StreamQuality = 'low1080'
const LOW_720: StreamQuality = 'low720'

const QUICK_LAN = { [LAN.url]: 20, [PUBLIC.url]: 200 }

const setUp = ({
  server = mediaServer({}),
  elapsedMs = QUICK_LAN,
  cookies = NAS_COOKIES,
  token = null,
  hasAccounts = false,
}: {
  server?: Pick<ReturnType<typeof mediaServer>, 'api' | 'heard'>
  elapsedMs?: Readonly<Record<string, number>>
  cookies?: ServerCookies
  token?: string | null
  hasAccounts?: boolean
} = {}) => {
  const clock = { now: READ_AT }
  const away: { maxHeight: MaxHeight } = { maxHeight: MAX_HEIGHTS.fullHd }
  const probes = probesOf({ elapsedMs })
  const network = fakeNetwork()
  const media = mediaAccessFor({
    api: server.api,
    server: NAS,
    now: () => clock.now,
    probe: probes.probe,
    readCredentials: async () => ({ cookies, token }),
    watchNetwork: network.watchNetwork,
    awayMaxHeight: () => away.maxHeight,
    hasAccounts: () => hasAccounts,
  })
  return { media, clock, away, probes, network, heard: server.heard }
}

const sourceOf = (outcome: SourceOutcome) => {
  if (!outcome.ok) throw new Error(`Expected a source, got ${outcome.reason}`)
  return outcome.source
}

const ticketed = ({ origin, path, ticket }: { origin: string; path: string; ticket: string }) =>
  `${origin}${path}?${toQueryString({ [MEDIA_TICKET_PARAM]: ticket })}`

const filePath = pathFor({ path: APP_CLIENT_CALLS.file.path, id: BUSBOYS.id })
const masterPath = pathFor({ path: HLS_PATHS.master, id: BUSBOYS.id })
const ticketPath = pathFor({ path: APP_CLIENT_CALLS.getMediaTicket.path, id: BUSBOYS.id })

const direct: SourceRequest = { media: BUSBOYS, mode: PLAYBACK_MODES.direct, audio: null }
const remux: SourceRequest = { media: BUSBOYS, mode: PLAYBACK_MODES.remux, audio: 1 }
const transcode: SourceRequest = { media: BUSBOYS, mode: PLAYBACK_MODES.transcode, audio: 0 }

/** Only the public origin answers: the device is away from home. */
const AWAY = { [PUBLIC.url]: 40 }

/** The quality the HLS master playlist of `source` asks for, or null for none. */
const qualityOf = (outcome: SourceOutcome): string | null => {
  const query = sourceOf(outcome).uri.split('?')[1] ?? ''
  const pair = query.split('&').find((part) => part.startsWith(`${HLS_PARAMS.quality}=`))
  return pair === undefined ? null : pair.slice(HLS_PARAMS.quality.length + 1)
}

const CONSOLE_METHODS = ['log', 'info', 'warn', 'error', 'debug'] as const

const cookieHeader = {
  [AUTH_HEADERS.cookie]: `${SERVER_COOKIES.unlock}=${NAS_COOKIES[SERVER_COOKIES.unlock]}`,
}

describe('mediaAccessFor', () => {
  it('plays from the LAN origin that answers fastest, by ticket and with no cookie', async () => {
    const { media, probes } = setUp()
    expect(sourceOf(await media.source(direct))).toEqual({
      uri: ticketed({ origin: LAN.url, path: filePath, ticket: TICKETS[0] }),
      headers: {},
    })
    expect(probes.probed.map((url) => url.split('/api/')[0])).toEqual([LAN.url, PUBLIC.url])
  })

  it('plays from the public origin when the LAN one is far slower or never answers', async () => {
    const slow = setUp({ elapsedMs: { [LAN.url]: 400, [PUBLIC.url]: 40 } })
    expect(sourceOf(await slow.media.source(direct)).uri.startsWith(`${PUBLIC.url}/`)).toBe(true)
    const away = setUp({ elapsedMs: { [PUBLIC.url]: 40 } })
    expect(sourceOf(await away.media.source(direct)).uri.startsWith(`${PUBLIC.url}/`)).toBe(true)
  })

  it('builds the HLS master playlist with its mode and audio, by ticket', async () => {
    const { media } = setUp()
    const query = toQueryString({
      [HLS_PARAMS.mode]: PLAYBACK_MODES.transcode,
      [HLS_PARAMS.audio]: '0',
      [MEDIA_TICKET_PARAM]: TICKETS[0],
    })
    expect(sourceOf(await media.source(transcode))).toEqual({
      uri: `${LAN.url}${masterPath}?${query}`,
      headers: {},
    })
  })

  it('caps a transcode from the public origin at the height chosen for away from home', async () => {
    const { media, away } = setUp({ elapsedMs: AWAY })
    const query = toQueryString({
      [HLS_PARAMS.mode]: PLAYBACK_MODES.transcode,
      [HLS_PARAMS.audio]: '0',
      [HLS_PARAMS.quality]: LOW_1080,
      [MEDIA_TICKET_PARAM]: TICKETS[0],
    })
    expect(sourceOf(await media.source(transcode))).toEqual({
      uri: `${PUBLIC.url}${masterPath}?${query}`,
      headers: {},
    })
    away.maxHeight = MAX_HEIGHTS.hd
    expect(qualityOf(await media.source(transcode))).toBe(LOW_720)
  })

  it('asks no cap at 4K, which the server ladder has no size for', async () => {
    const { media, away } = setUp({ elapsedMs: AWAY })
    away.maxHeight = MAX_HEIGHTS.uhd
    expect(qualityOf(await media.source(transcode))).toBeNull()
  })

  it('asks no cap from a LAN origin, at home', async () => {
    const { media } = setUp()
    const outcome = await media.source(transcode)
    expect(sourceOf(outcome).uri.startsWith(`${LAN.url}/`)).toBe(true)
    expect(qualityOf(outcome)).toBeNull()
  })

  it('asks no cap of a remux, which copies the video and which the server sizes not', async () => {
    const { media } = setUp({ elapsedMs: AWAY })
    expect(qualityOf(await media.source(remux))).toBeNull()
  })

  it('keeps a ticket until its renewal comes, then renews it before building the source', async () => {
    const { media, clock, heard } = setUp()
    expect(sourceOf(await media.source(direct)).uri).toContain(TICKETS[0])
    clock.now = READ_AT + MEDIA_TICKET_RENEW_MS - 1
    expect(sourceOf(await media.source(remux)).uri).toContain(TICKETS[0])
    expect(heard.filter((path) => path === ticketPath)).toHaveLength(1)
    clock.now = READ_AT + MEDIA_TICKET_RENEW_MS
    expect(sourceOf(await media.source(remux)).uri).toContain(TICKETS[1])
    expect(heard.filter((path) => path === ticketPath)).toHaveLength(2)
  })

  it('shares one probe and one ticket read between two sources asked for at once', async () => {
    const { media, probes, heard } = setUp()
    const [file, playlist] = await Promise.all([media.source(direct), media.source(remux)])
    expect(sourceOf(file).uri).toContain(TICKETS[0])
    expect(sourceOf(playlist).uri).toContain(TICKETS[0])
    expect(probes.probed).toHaveLength(2)
    expect(heard.filter((path) => path === ticketPath)).toHaveLength(1)
  })

  it('probes again when the network changes, and plays from the new pick', async () => {
    const { media, probes, network } = setUp()
    expect(sourceOf(await media.source(direct)).uri.startsWith(`${LAN.url}/`)).toBe(true)
    await media.source(direct)
    expect(probes.probed).toHaveLength(2)
    probes.retime({ [PUBLIC.url]: 60 })
    network.change()
    expect(sourceOf(await media.source(direct)).uri).toBe(
      ticketed({ origin: PUBLIC.url, path: filePath, ticket: TICKETS[0] }),
    )
    expect(probes.probed).toHaveLength(4)
  })

  it('probes again on the next source after a probe no origin answered, as one may come back', async () => {
    const { media, probes } = setUp({ elapsedMs: {} })
    expect(sourceOf(await media.source(direct)).uri.startsWith(`${NAS.origin}/`)).toBe(true)
    expect(probes.probed).toHaveLength(2)
    probes.retime(QUICK_LAN)
    expect(sourceOf(await media.source(direct)).uri.startsWith(`${LAN.url}/`)).toBe(true)
    expect(probes.probed).toHaveLength(4)
    await media.source(direct)
    expect(probes.probed).toHaveLength(4)
  })

  it('stops watching the network once closed', () => {
    const { media, network } = setUp()
    expect(network.watchers()).toBe(1)
    media.close()
    expect(network.watchers()).toBe(0)
  })

  it("sends the cookie to the server's own address, file and HLS alike, when it hands out no ticket", async () => {
    const { media } = setUp({ server: mediaServer({ tickets: [STATUSES.unavailable] }) })
    expect(sourceOf(await media.source(direct))).toEqual({
      uri: `${NAS.origin}${filePath}`,
      headers: cookieHeader,
    })
    const query = toQueryString({
      [HLS_PARAMS.mode]: PLAYBACK_MODES.remux,
      [HLS_PARAMS.audio]: '1',
    })
    expect(sourceOf(await media.source(remux))).toEqual({
      uri: `${NAS.origin}${masterPath}?${query}`,
      headers: cookieHeader,
    })
  })

  it('sends the cookie when the server lists no origin, or none answers', async () => {
    const unlisted = setUp({
      server: mediaServer({ origins: [], tickets: [STATUSES.unavailable] }),
    })
    expect(sourceOf(await unlisted.media.source(direct))).toEqual({
      uri: `${NAS.origin}${filePath}`,
      headers: cookieHeader,
    })
    expect(unlisted.probes.probed).toEqual([])
    const silent = setUp({ elapsedMs: {} })
    expect(sourceOf(await silent.media.source(direct))).toEqual({
      uri: `${NAS.origin}${filePath}`,
      headers: cookieHeader,
    })
    const refused = setUp({ server: mediaServer({ originsStatus: STATUSES.failed }) })
    expect(sourceOf(await refused.media.source(direct)).headers).toEqual(cookieHeader)
  })

  it('sends no cookie header when the jar holds none', async () => {
    const { media } = setUp({ server: mediaServer({ origins: [] }), cookies: {} })
    expect(sourceOf(await media.source(direct))).toEqual({
      uri: `${NAS.origin}${filePath}`,
      headers: {},
    })
  })

  it('never probes an origin that is not a plain http or https address', async () => {
    const odd = { kind: MEDIA_ORIGIN_KINDS.lan, url: 'file:///etc' }
    const { media, probes } = setUp({ server: mediaServer({ origins: [odd, PUBLIC] }) })
    expect(sourceOf(await media.source(direct)).uri.startsWith(`${PUBLIC.url}/`)).toBe(true)
    expect(probes.probed.every((url) => url.startsWith(`${PUBLIC.url}/`))).toBe(true)
  })

  it('refuses, never rejects, when the jar cannot be read', async () => {
    const server = mediaServer({ tickets: [STATUSES.unavailable] })
    const media = mediaAccessFor({
      api: server.api,
      server: NAS,
      now: () => READ_AT,
      probe: probesOf({ elapsedMs: QUICK_LAN }).probe,
      readCredentials: async () => {
        throw new Error('The keychain is locked')
      },
      watchNetwork: fakeNetwork().watchNetwork,
      awayMaxHeight: () => MAX_HEIGHTS.fullHd,
      hasAccounts: () => false,
    })
    expect(await media.source(direct)).toEqual({
      ok: false,
      reason: ACCESS_REFUSALS.unreachable,
      message: MEDIA_ACCESS_MESSAGES.unreachable(NAS.name),
    })
  })

  it('refuses a video in a locked library', async () => {
    const { media } = setUp({ server: mediaServer({ tickets: [STATUSES.locked] }) })
    expect(await media.source(direct)).toEqual({
      ok: false,
      reason: ACCESS_REFUSALS.locked,
      message: MEDIA_ACCESS_MESSAGES.locked(NAS.name),
    })
  })

  it('refuses a video the server no longer has, or a server that fails, and asks again after', async () => {
    const { media } = setUp({
      server: mediaServer({ tickets: [STATUSES.notFound, STATUSES.failed, STATUSES.ok] }),
    })
    expect(await media.source(direct)).toEqual({
      ok: false,
      reason: ACCESS_REFUSALS.gone,
      message: MEDIA_ACCESS_MESSAGES.gone(NAS.name),
    })
    expect(await media.source(direct)).toEqual({
      ok: false,
      reason: ACCESS_REFUSALS.unreachable,
      message: MEDIA_ACCESS_MESSAGES.unreachable(NAS.name),
    })
    expect(sourceOf(await media.source(direct)).uri).toContain(TICKETS[0])
  })

  it('never puts a ticket in a log line or a refusal, whatever the server answers', async () => {
    const spies = CONSOLE_METHODS.map((method) =>
      spyOn(console, method).mockImplementation(() => undefined),
    )
    try {
      const issued = setUp()
      await issued.media.source(direct)
      issued.clock.now = READ_AT + MEDIA_TICKET_RENEW_MS
      await issued.media.source(transcode)
      issued.network.change()
      await issued.media.source(remux)
      const refusing = setUp({
        server: mediaServer({
          tickets: [STATUSES.locked, STATUSES.unavailable, STATUSES.notFound],
        }),
      })
      const outcomes = [
        await refusing.media.source(direct),
        await refusing.media.source(direct),
        await refusing.media.source(direct),
      ]
      const logged = spies.flatMap((spy) => spy.mock.calls.flat()).map(String)
      const messages = outcomes.flatMap((outcome) => (outcome.ok ? [] : [outcome.message]))
      expect(
        [...logged, ...messages].filter((line) => TICKETS.some((ticket) => line.includes(ticket))),
      ).toEqual([])
    } finally {
      spies.forEach((spy) => spy.mockRestore())
    }
  })
})

describe('mediaAccessFor on a server with accounts', () => {
  const TOKEN = 'eyJhbGciOiJFUzI1NiJ9.eyJuIjoiMSJ9.c2ln'
  const mintPath = pathFor({ path: APP_CLIENT_CALLS.getAccountTicket.path, id: BUSBOYS.id })

  const accountSetUp = ({
    server = accountServer({}),
    elapsedMs = QUICK_LAN,
  }: {
    server?: ReturnType<typeof accountServer>
    elapsedMs?: Readonly<Record<string, number>>
  } = {}) => ({
    ...setUp({ server, elapsedMs, token: TOKEN, hasAccounts: true }),
    server,
  })

  const refusedWith = (message: string): SourceOutcome => ({
    ok: false,
    reason: ACCESS_REFUSALS.account,
    message,
  })

  it('plays a direct source from the picked origin by an account ticket, with no cookie and no Bearer', async () => {
    const { media, heard } = accountSetUp()
    expect(sourceOf(await media.source(direct))).toEqual({
      uri: ticketed({ origin: LAN.url, path: filePath, ticket: ACCOUNT_TICKETS[0] }),
      headers: {},
    })
    expect(heard).not.toContain(ticketPath)
    expect(heard).toContain(mintPath)
  })

  it("plays from the server's own address by account ticket when no origin answers, never by cookie", async () => {
    const unlisted = accountSetUp({ server: accountServer({ origins: [] }) })
    expect(sourceOf(await unlisted.media.source(direct))).toEqual({
      uri: ticketed({ origin: NAS.origin, path: filePath, ticket: ACCOUNT_TICKETS[0] }),
      headers: {},
    })
    const silent = accountSetUp({ elapsedMs: {} })
    const query = toQueryString({
      [HLS_PARAMS.mode]: PLAYBACK_MODES.remux,
      [HLS_PARAMS.audio]: '1',
      [MEDIA_TICKET_PARAM]: ACCOUNT_TICKETS[0],
    })
    expect(sourceOf(await silent.media.source(remux))).toEqual({
      uri: `${NAS.origin}${masterPath}?${query}`,
      headers: {},
    })
  })

  it('opens a remux master by account ticket, and mints a fresh one for every source and step down', async () => {
    const { media, heard } = accountSetUp()
    expect(sourceOf(await media.source(direct)).uri).toContain(ACCOUNT_TICKETS[0])
    const query = toQueryString({
      [HLS_PARAMS.mode]: PLAYBACK_MODES.remux,
      [HLS_PARAMS.audio]: '1',
      [MEDIA_TICKET_PARAM]: ACCOUNT_TICKETS[1],
    })
    expect(sourceOf(await media.source(remux))).toEqual({
      uri: `${LAN.url}${masterPath}?${query}`,
      headers: {},
    })
    expect(sourceOf(await media.source(remux)).uri).toContain(ACCOUNT_TICKETS[2])
    expect(heard.filter((path) => path === mintPath)).toHaveLength(3)
  })

  it('caps a transcode from the public origin, and asks none from its own address', async () => {
    const away = accountSetUp({ elapsedMs: AWAY })
    expect(qualityOf(await away.media.source(transcode))).toBe(LOW_1080)
    const own = accountSetUp({ server: accountServer({ origins: [] }) })
    expect(qualityOf(await own.media.source(transcode))).toBeNull()
  })

  it('mints once more with a refreshed token when the server refuses the first as signed out', async () => {
    const server = accountServer({
      mints: [
        { status: STATUSES.unauthorized, reason: AUTH_REFUSALS.signedOut },
        { status: STATUSES.ok },
      ],
    })
    const { media } = accountSetUp({ server })
    expect(sourceOf(await media.source(direct)).uri).toContain(ACCOUNT_TICKETS[0])
    expect(server.bearers).toEqual([
      `${AUTH_SCHEME} ${ACCOUNT_TOKENS.signedIn}`,
      `${AUTH_SCHEME} ${ACCOUNT_TOKENS.refreshed}`,
    ])
    expect(server.rejections()).toBe(0)
  })

  it('asks the viewer to sign in again when the refreshed token is refused too', async () => {
    const server = accountServer({
      mints: [{ status: STATUSES.unauthorized, reason: AUTH_REFUSALS.signedOut }],
    })
    const { media } = accountSetUp({ server })
    expect(await media.source(direct)).toEqual(
      refusedWith(ACCOUNT_ACCESS_MESSAGES.signInAgain(NAS.name)),
    )
    expect(server.bearers).toHaveLength(2)
    expect(server.rejections()).toBe(1)
  })

  it('says the access was removed for an account revoked, sent back to waiting or refused with no reason', async () => {
    const outcomes = await Promise.all(
      [AUTH_REFUSALS.revoked, AUTH_REFUSALS.pending, AUTH_REFUSALS.notOwner, null].map(
        async (reason) =>
          accountSetUp({
            server: accountServer({ mints: [{ status: STATUSES.forbidden, reason }] }),
          }).media.source(direct),
      ),
    )
    expect(outcomes).toEqual(
      outcomes.map(() => refusedWith(ACCOUNT_ACCESS_MESSAGES.removed(NAS.name))),
    )
  })

  it('says accounts being down is an outage, and a locked library is locked', async () => {
    const down = accountSetUp({
      server: accountServer({
        mints: [{ status: STATUSES.unavailable, reason: AUTH_REFUSALS.unavailable }],
      }),
    })
    expect(await down.media.source(direct)).toEqual({
      ok: false,
      reason: ACCESS_REFUSALS.unreachable,
      message: MEDIA_ACCESS_MESSAGES.unreachable(NAS.name),
    })
    const locked = accountSetUp({
      server: accountServer({ mints: [{ status: STATUSES.locked, reason: null }] }),
    })
    expect(await locked.media.source(direct)).toEqual({
      ok: false,
      reason: ACCESS_REFUSALS.locked,
      message: MEDIA_ACCESS_MESSAGES.locked(NAS.name),
    })
  })

  it('never puts an account ticket in a log line or a refusal', async () => {
    const spies = CONSOLE_METHODS.map((method) =>
      spyOn(console, method).mockImplementation(() => undefined),
    )
    try {
      const { media } = accountSetUp()
      await media.source(direct)
      await media.source(remux)
      const refused = await accountSetUp({
        server: accountServer({ mints: [{ status: STATUSES.forbidden, reason: null }] }),
      }).media.source(direct)
      const logged = spies.flatMap((spy) => spy.mock.calls.flat()).map(String)
      const messages = refused.ok ? [] : [refused.message]
      expect(
        [...logged, ...messages].filter((line) =>
          ACCOUNT_TICKETS.some((ticket) => line.includes(ticket)),
        ),
      ).toEqual([])
    } finally {
      spies.forEach((spy) => spy.mockRestore())
    }
  })
})
