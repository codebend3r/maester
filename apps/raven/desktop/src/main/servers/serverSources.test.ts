import { afterEach, describe, expect, jest, test } from 'bun:test'
import {
  AUTH_REFUSALS,
  MEDIA_ORIGIN_KINDS,
  type MediaOrigin,
  type MediaTracks,
  PLAYER_ERROR_REASONS,
  PLAYER_SOURCE_KINDS,
  type RemotePlayback,
  type SubtitleTrack,
} from '@raven/core'
import type { ServerEntry } from '@/main/desktopConfig'
import type { ServerTarget } from '@/main/player/loadTarget'
import { PLAYER_PHASES } from '@/main/player/phases'
import { PLAYER_MESSAGES } from '@/main/player/playerMessages'
import { TICKET_OUTCOMES, type TicketOutcome } from '@/main/servers/accountTickets'
import { CALL_NAMES, type AllowedCall } from '@/main/servers/allowlist'
import { type MediaRelay, RELAYED_MEDIA_KINDS } from '@/main/servers/mediaRelay'
import type { ServerCallResult } from '@/main/servers/serverCalls'
import { fixedPicks } from '@/main/test/serverFakes'
import { mediaItemFor } from '@/shared/test/mediaItem'
import {
  createServerSources,
  EXPLAIN_TIMEOUT_MS,
  MEDIA_TIMEOUT_MS,
  SOURCE_MESSAGES,
  TRACKS_TIMEOUT_MS,
} from '@/main/servers/serverSources'

const SERVER: ServerEntry = {
  id: '00000000-0000-4000-8000-000000000001',
  origin: 'https://raven.example',
}
const OTHER_ID = '00000000-0000-4000-8000-000000000002'

const subtitle = (
  fields: Pick<SubtitleTrack, 'id' | 'source'> & Partial<SubtitleTrack>,
): SubtitleTrack => ({
  codec: 'subrip',
  language: null,
  title: null,
  default: false,
  forced: false,
  hearingImpaired: false,
  supported: true,
  ...fields,
})

const TRACKS: MediaTracks = {
  audio: [],
  subtitles: [
    subtitle({ id: 'embedded-0', source: 'embedded', language: 'fr' }),
    subtitle({ id: 'external-0', source: 'external', language: 'en', title: 'English SDH' }),
    subtitle({ id: 'external-1', source: 'external' }),
  ],
  defaultAudio: null,
  frameRate: null,
}

type ReplyProps = { status: number; body: string }

const reply = ({ status, body }: ReplyProps): ServerCallResult => ({
  ok: true,
  status,
  body,
})

type FakeCallsProps = { answer: (call: AllowedCall) => ServerCallResult | null }

/** Calls answered by `answer`, or held until the test settles them when it gives null. */
const fakeCalls = ({ answer }: FakeCallsProps) => {
  const made: { call: AllowedCall }[] = []
  type CallsCallProps = { call: AllowedCall }

  const calls = {
    call: ({ call }: CallsCallProps) => {
      made.push({ call })
      const answered = answer(call)
      if (answered === null) return new Promise<ServerCallResult>(() => {})
      return Promise.resolve(answered)
    },
  }
  return { calls, made }
}

const RELAY_BASE = `http://127.0.0.1:4000/${'s'.repeat(43)}`

type FakeRelayProps = {
  refusal?: ReturnType<MediaRelay['refusalOf']>
  isOpenFailing?: boolean
}

/** A relay that answers fixed URLs, keeping what it was asked. */
const fakeRelay = ({ refusal = null, isOpenFailing = false }: FakeRelayProps) => {
  const opened: Parameters<MediaRelay['open']>[0][] = []
  const closed: string[] = []
  const refusalsAsked: string[] = []
  const relay: Pick<MediaRelay, 'open' | 'refusalOf' | 'close'> = {
    open: async (input) => {
      opened.push(input)
      if (isOpenFailing) throw new Error(`${RELAY_BASE} would not listen`)
      return {
        loadId: '1',
        base: RELAY_BASE,
        fileUrl: `${RELAY_BASE}/file`,
        sidecarUrls: input.sidecarTrackIds.map((id) => `${RELAY_BASE}/subtitles/${id}`),
      }
    },
    refusalOf: (loadId) => {
      refusalsAsked.push(loadId)
      return refusal
    },
    close: (loadId) => {
      closed.push(loadId)
    },
  }
  return { relay, opened, closed, refusalsAsked }
}

type SetupProps = {
  answer?: (call: AllowedCall) => ServerCallResult | null
  ticket?: TicketOutcome
  refusal?: ReturnType<MediaRelay['refusalOf']>
  isOpenFailing?: boolean
  /** The media origin picked; unset, each server's own address. */
  origin?: MediaOrigin
  /** What the server says of remote play; unset, nothing. */
  remote?: RemotePlayback
}

const setup = ({
  answer = () => reply({ status: 200, body: JSON.stringify(TRACKS) }),
  ticket = { kind: TICKET_OUTCOMES.ticket, ticket: 'account.t1' },
  refusal = null,
  isOpenFailing = false,
  origin,
  remote,
}: SetupProps = {}) => {
  const { calls, made } = fakeCalls({ answer })
  const { picks, forgets } = fixedPicks({ serverOrigin: SERVER.origin, origin, remote })
  const warnings: string[] = []
  const minted: { mediaId: number; isFresh: boolean }[] = []
  const order: string[] = []
  const relayed = fakeRelay({ refusal, isOpenFailing })
  const sources = createServerSources({
    server: SERVER,
    calls,
    tickets: {
      ticketFor: async (input) => {
        order.push('mint')
        minted.push(input)
        return ticket
      },
    },
    relay: {
      ...relayed.relay,
      open: (input) => {
        order.push('open')
        return relayed.relay.open(input)
      },
    },
    picks,
    warn: (message) => {
      warnings.push(message)
    },
  })
  return { sources, made, warnings, minted, order, forgets, ...relayed }
}

const RELAYED_TARGET: ServerTarget = {
  kind: PLAYER_SOURCE_KINDS.server,
  mediaId: 7,
  url: `${RELAY_BASE}/file`,
  sidecars: [],
  relay: { loadId: '1', base: RELAY_BASE },
}

const SOURCE = { kind: PLAYER_SOURCE_KINDS.server, serverId: SERVER.id, mediaId: 7 } as const

describe('resolve', () => {
  test('mints the first ticket, then plays through the relay with no header and the external sidecars in order', async () => {
    const { sources, made, minted, opened, order, warnings } = setup()
    expect(await sources.resolve(SOURCE)).toEqual({
      ok: true,
      target: {
        kind: PLAYER_SOURCE_KINDS.server,
        mediaId: 7,
        url: `${RELAY_BASE}/file`,
        relay: { loadId: '1', base: RELAY_BASE },
        sidecars: [
          { url: `${RELAY_BASE}/subtitles/external-0`, title: 'English SDH', language: 'en' },
          { url: `${RELAY_BASE}/subtitles/external-1`, title: '', language: '' },
        ],
      },
    })
    expect(made).toEqual([{ call: { name: CALL_NAMES.getTracks, mediaId: 7 } }])
    expect(minted).toEqual([{ mediaId: 7, isFresh: false }])
    expect(opened).toEqual([
      {
        origin: SERVER.origin,
        mediaId: 7,
        sidecarTrackIds: ['external-0', 'external-1'],
        media: { kind: RELAYED_MEDIA_KINDS.file },
      },
    ])
    expect(order).toEqual(['mint', 'open'])
    expect(warnings).toEqual([])
  })

  test('relays a video and a track from the media origin picked', async () => {
    const lan = { kind: MEDIA_ORIGIN_KINDS.lan, url: 'https://192-168-50-6.vhagar.example' }
    const { sources, opened, minted } = setup({ origin: lan })
    await sources.resolve(SOURCE)
    await sources.resolveTrack({ mediaId: 8, kbps: 256 })
    expect(opened.map(({ origin }) => origin)).toEqual([lan.url, lan.url])
    expect(minted).toHaveLength(2)
  })

  test('a track asks for no sidecars, and opens its transcode at the bitrate asked', async () => {
    const { sources, made, opened } = setup()
    const track = { mediaId: 7 }
    expect(await sources.resolveTrack({ ...track, kbps: 256 })).toEqual({
      ok: true,
      target: RELAYED_TARGET,
    })
    await sources.resolveTrack({ ...track, kbps: null })
    expect(made).toEqual([])
    expect(opened).toEqual([
      {
        origin: SERVER.origin,
        mediaId: 7,
        sidecarTrackIds: [],
        media: { kind: RELAYED_MEDIA_KINDS.audio, kbps: 256 },
      },
      {
        origin: SERVER.origin,
        mediaId: 7,
        sidecarTrackIds: [],
        media: { kind: RELAYED_MEDIA_KINDS.file },
      },
    ])
    expect(await sources.resolveTrack({ mediaId: 7.5, kbps: null })).toEqual({
      ok: false,
      message: SOURCE_MESSAGES.badTitle,
    })
  })

  test('only sidecars named external-N are relayed, so nothing else reaches a path', async () => {
    const odd: MediaTracks = {
      ...TRACKS,
      subtitles: [
        subtitle({ id: '../../lock/unlock?x', source: 'external' }),
        subtitle({ id: 'external-1/../../x', source: 'external' }),
        subtitle({ id: 'external-', source: 'external' }),
        subtitle({ id: 'external-12', source: 'external', language: 'de' }),
      ],
    }
    const { sources, opened } = setup({
      answer: () => reply({ status: 200, body: JSON.stringify(odd) }),
    })
    const resolved = await sources.resolve(SOURCE)
    if (!resolved.ok || resolved.target.kind !== PLAYER_SOURCE_KINDS.server)
      throw new Error('expected a server')
    expect(opened.map(({ sidecarTrackIds }) => sidecarTrackIds)).toEqual([['external-12']])
    expect(resolved.target.sidecars).toEqual([
      { url: `${RELAY_BASE}/subtitles/external-12`, title: '', language: 'de' },
    ])
  })

  test('tracks held past the timeout give no sidecars, and the title still resolves', async () => {
    jest.useFakeTimers()
    try {
      const { sources, warnings } = setup({ answer: () => null })
      const resolving = sources.resolve(SOURCE)
      jest.advanceTimersByTime(TRACKS_TIMEOUT_MS)
      const resolved = await resolving
      if (!resolved.ok || resolved.target.kind !== PLAYER_SOURCE_KINDS.server)
        throw new Error('expected a server')
      expect(resolved.target.url).toBe(`${RELAY_BASE}/file`)
      expect(resolved.target.sidecars).toEqual([])
      expect(warnings).toEqual(['no sidecars from raven: its tracks did not answer in time'])
      expect(TRACKS_TIMEOUT_MS).toBe(3000)
    } finally {
      jest.useRealTimers()
    }
  })

  test.each([
    ['a 500', reply({ status: 500, body: '{"message":"boom"}' })],
    ['an HTML page', reply({ status: 200, body: '<html>' })],
    ['a body that is not tracks', reply({ status: 200, body: '{"audio":3}' })],
    ['an unreachable server', { ok: false, message: 'Raven could not reach raven.' }],
  ] as const)('tracks answering %s give no sidecars and a warning', async (_label, answered) => {
    const { sources, warnings } = setup({ answer: () => answered })
    const resolved = await sources.resolve(SOURCE)
    if (!resolved.ok || resolved.target.kind !== PLAYER_SOURCE_KINDS.server)
      throw new Error('expected a server')
    expect(resolved.target.sidecars).toEqual([])
    expect(warnings.length).toBe(1)
    expect(warnings.join('')).not.toContain('account.t1')
    expect(warnings.join('')).not.toContain('https://')
  })

  test('a tracks call that rejects still resolves, with no sidecars and a warning', async () => {
    const warnings: string[] = []
    const { relay } = fakeRelay({})
    const sources = createServerSources({
      server: SERVER,
      calls: { call: () => Promise.reject(new Error('gone')) },
      tickets: { ticketFor: async () => ({ kind: TICKET_OUTCOMES.ticket, ticket: 't' }) },
      relay,
      picks: fixedPicks({ serverOrigin: SERVER.origin }).picks,
      warn: (message) => {
        warnings.push(message)
      },
    })
    const resolved = await sources.resolve(SOURCE)
    if (!resolved.ok || resolved.target.kind !== PLAYER_SOURCE_KINDS.server)
      throw new Error('expected a server')
    expect(resolved.target.sidecars).toEqual([])
    expect(warnings).toEqual(['no sidecars from raven: its tracks failed: gone'])
  })

  test('a server id that is not opaque and a media id that is not whole are bad titles that call nothing', async () => {
    const { sources, made, minted } = setup()
    expect(await sources.resolve({ ...SOURCE, serverId: 'vhagar' })).toEqual({
      ok: false,
      message: SOURCE_MESSAGES.badTitle,
    })
    expect(await sources.resolve({ ...SOURCE, mediaId: 7.5 })).toEqual({
      ok: false,
      message: SOURCE_MESSAGES.badTitle,
    })
    expect(made).toEqual([])
    expect(minted).toEqual([])
  })

  test('another server is refused and calls nothing', async () => {
    const { sources, made, minted } = setup()
    expect(await sources.resolve({ ...SOURCE, serverId: OTHER_ID })).toEqual({
      ok: false,
      message: SOURCE_MESSAGES.otherServer,
    })
    expect(made).toEqual([])
    expect(minted).toEqual([])
  })

  test.each([
    [
      'signed out',
      { kind: TICKET_OUTCOMES.refused, reason: AUTH_REFUSALS.signedOut },
      SOURCE_MESSAGES.signIn,
    ],
    [
      'removed',
      { kind: TICKET_OUTCOMES.refused, reason: AUTH_REFUSALS.revoked },
      SOURCE_MESSAGES.removed,
    ],
    [
      'awaiting approval',
      { kind: TICKET_OUTCOMES.refused, reason: AUTH_REFUSALS.pending },
      SOURCE_MESSAGES.pending,
    ],
    ['locked', { kind: TICKET_OUTCOMES.locked }, SOURCE_MESSAGES.relocked],
    ['gone', { kind: TICKET_OUTCOMES.gone }, SOURCE_MESSAGES.gone],
    ['unreachable', { kind: TICKET_OUTCOMES.unreachable }, SOURCE_MESSAGES.lost],
  ] as const)(
    'a title whose ticket is %s is refused before mpv opens anything',
    async (_label, ticket, message) => {
      const { sources, opened } = setup({ ticket })
      expect(await sources.resolve(SOURCE)).toEqual({ ok: false, message })
      expect(opened).toEqual([])
    },
  )

  test('a relay that cannot open is a title Raven could not open, with nothing secret said', async () => {
    const { sources, warnings } = setup({ isOpenFailing: true })
    expect(await sources.resolve(SOURCE)).toEqual({
      ok: false,
      message: SOURCE_MESSAGES.cannotOpen,
    })
    expect(warnings).toEqual(['Raven could not relay a title from raven'])
  })
})

describe('refusedAccount', () => {
  test("reads the relay's refusal for a relayed title without closing it or asking the server", () => {
    const { sources, closed, made } = setup({ refusal: AUTH_REFUSALS.revoked })
    expect(sources.refusedAccount(RELAYED_TARGET)).toEqual({
      reason: PLAYER_ERROR_REASONS.account,
      message: SOURCE_MESSAGES.removed,
    })
    expect(closed).toEqual([])
    expect(made).toEqual([])
  })

  test('is null for a load with no refusal', () => {
    expect(setup().sources.refusedAccount(RELAYED_TARGET)).toBeNull()
  })
})

describe('explain', () => {
  afterEach(() => {
    jest.useRealTimers()
  })

  test('asks the server for the title once', async () => {
    const { sources, made } = setup({ answer: () => reply({ status: 200, body: '{}' }) })
    await sources.explain({ target: RELAYED_TARGET, phase: PLAYER_PHASES.loaded })
    expect(made).toEqual([{ call: { name: CALL_NAMES.getMedia, mediaId: 7 } }])
  })

  test('an unreachable server lost the connection', async () => {
    const { sources } = setup({
      answer: () => ({ ok: false, message: 'Raven could not reach raven.' }),
    })
    expect(await sources.explain({ target: RELAYED_TARGET, phase: PLAYER_PHASES.loaded })).toEqual({
      reason: 'network',
      message: SOURCE_MESSAGES.lost,
    })
  })

  test('a call held past the timeout lost the connection', async () => {
    jest.useFakeTimers()
    const { sources } = setup({ answer: () => null })
    const explained = sources.explain({ target: RELAYED_TARGET, phase: PLAYER_PHASES.loading })
    jest.advanceTimersByTime(EXPLAIN_TIMEOUT_MS)
    expect(await explained).toEqual({
      reason: PLAYER_ERROR_REASONS.network,
      message: SOURCE_MESSAGES.lost,
    })
    expect(EXPLAIN_TIMEOUT_MS).toBe(5000)
  })

  test('a 423 is the library locked again', async () => {
    const { sources } = setup({ answer: () => reply({ status: 423, body: '{}' }) })
    expect(await sources.explain({ target: RELAYED_TARGET, phase: PLAYER_PHASES.loaded })).toEqual({
      reason: PLAYER_ERROR_REASONS.locked,
      message: 'raven locked this library again.',
    })
  })

  test('a 404 is a title that is gone', async () => {
    const { sources } = setup({ answer: () => reply({ status: 404, body: '{}' }) })
    expect(await sources.explain({ target: RELAYED_TARGET, phase: PLAYER_PHASES.loading })).toEqual(
      {
        reason: PLAYER_ERROR_REASONS.open,
        message: SOURCE_MESSAGES.gone,
      },
    )
  })

  test('a 200 keeps the reason mpv had, by phase', async () => {
    const { sources } = setup({ answer: () => reply({ status: 200, body: '{}' }) })
    expect(await sources.explain({ target: RELAYED_TARGET, phase: PLAYER_PHASES.loading })).toEqual(
      {
        reason: PLAYER_ERROR_REASONS.open,
        message: SOURCE_MESSAGES.cannotOpen,
      },
    )
    expect(await sources.explain({ target: RELAYED_TARGET, phase: PLAYER_PHASES.loaded })).toEqual({
      reason: 'decode',
      message: PLAYER_MESSAGES.stopped,
    })
  })

  test('a relayed load the server refused is read off the relay as removed access', async () => {
    const { sources, made, refusalsAsked, closed } = setup({
      refusal: AUTH_REFUSALS.revoked,
    })
    expect(await sources.explain({ target: RELAYED_TARGET, phase: PLAYER_PHASES.loaded })).toEqual({
      reason: PLAYER_ERROR_REASONS.account,
      message: 'Your access to raven was removed.',
    })
    expect(refusalsAsked).toEqual(['1'])
    expect(closed).toEqual(['1'])
    expect(made).toEqual([])
  })

  test.each([[AUTH_REFUSALS.pending], [AUTH_REFUSALS.notOwner]] as const)(
    'a relayed load refused as %s is removed access too',
    async (refusal) => {
      const { sources } = setup({ refusal })
      expect(
        await sources.explain({ target: RELAYED_TARGET, phase: PLAYER_PHASES.loaded }),
      ).toEqual({
        reason: PLAYER_ERROR_REASONS.account,
        message: SOURCE_MESSAGES.removed,
      })
    },
  )

  test('a relayed load whose account was signed out asks for a sign in', async () => {
    const { sources } = setup({ refusal: AUTH_REFUSALS.signedOut })
    expect(await sources.explain({ target: RELAYED_TARGET, phase: PLAYER_PHASES.loading })).toEqual(
      {
        reason: PLAYER_ERROR_REASONS.account,
        message: 'Sign in to raven again.',
      },
    )
  })

  test('a relayed load with no refusal asks the server, and closes the load', async () => {
    const { sources, made, closed } = setup({
      answer: () => reply({ status: 423, body: '{}' }),
    })
    expect(await sources.explain({ target: RELAYED_TARGET, phase: PLAYER_PHASES.loaded })).toEqual({
      reason: PLAYER_ERROR_REASONS.locked,
      message: 'raven locked this library again.',
    })
    expect(made).toEqual([{ call: { name: CALL_NAMES.getMedia, mediaId: 7 } }])
    expect(closed).toEqual(['1'])
  })

  test('lets go of the origin picked, so the next title probes again', async () => {
    const { sources, forgets } = setup({ answer: () => reply({ status: 200, body: '{}' }) })
    await sources.explain({ target: RELAYED_TARGET, phase: PLAYER_PHASES.loaded })
    expect(forgets.count).toBe(1)
  })

  test('keeps the origin picked for a title the account was refused', async () => {
    const { sources, forgets } = setup({ refusal: AUTH_REFUSALS.revoked })
    await sources.explain({ target: RELAYED_TARGET, phase: PLAYER_PHASES.loaded })
    expect(forgets.count).toBe(0)
  })

  test("the server's own account refusal of the title is the account's", async () => {
    const { sources } = setup({
      answer: () =>
        reply({
          status: 401,
          body: JSON.stringify({ reason: AUTH_REFUSALS.signedOut, message: 'no' }),
        }),
    })
    expect(await sources.explain({ target: RELAYED_TARGET, phase: PLAYER_PHASES.loaded })).toEqual({
      reason: PLAYER_ERROR_REASONS.account,
      message: SOURCE_MESSAGES.signInAgain,
    })
  })
})

describe('resolve away from home', () => {
  const PUBLIC = { kind: MEDIA_ORIGIN_KINDS.public, url: 'https://raven.example' }
  const LAN = { kind: MEDIA_ORIGIN_KINDS.lan, url: 'https://192-168-50-6.vhagar.example' }
  const HELD = { limit: 'high720', isOutside: true } as const satisfies RemotePlayback
  const TRANSCODE = { kind: RELAYED_MEDIA_KINDS.transcode, quality: 'high720' } as const
  const FILE = { kind: RELAYED_MEDIA_KINDS.file } as const

  type AnswerOfProps = { bitrate: number | null }

  /** The server: the tracks, and the title at `bitrate`. */
  const answerOf =
    ({ bitrate }: AnswerOfProps) =>
    (call: AllowedCall): ServerCallResult =>
      call.name === CALL_NAMES.getMedia
        ? reply({ status: 200, body: JSON.stringify(mediaItemFor({ bitrate })) })
        : reply({ status: 200, body: JSON.stringify(TRACKS) })

  const OVER = answerOf({ bitrate: 30_000_000 })

  test("a file over the limit from the public origin plays as the server's transcode at that limit", async () => {
    const { sources, opened, made } = setup({ answer: OVER, origin: PUBLIC, remote: HELD })
    const resolved = await sources.resolve(SOURCE)
    expect(resolved.ok).toBe(true)
    expect(opened.map(({ media, origin }) => ({ media, origin }))).toEqual([
      { media: TRANSCODE, origin: PUBLIC.url },
    ])
    expect(made.map(({ call }) => call.name).toSorted()).toEqual([
      CALL_NAMES.getMedia,
      CALL_NAMES.getTracks,
    ])
  })

  test("from the server's own address, the server's word on where the Mac is decides", async () => {
    const outside = setup({ answer: OVER, remote: HELD })
    await outside.sources.resolve(SOURCE)
    expect(outside.opened.map(({ media }) => media)).toEqual([TRANSCODE])

    const inside = setup({ answer: OVER, remote: { ...HELD, isOutside: false } })
    await inside.sources.resolve(SOURCE)
    expect(inside.opened.map(({ media }) => media)).toEqual([FILE])
    expect(inside.made.map(({ call }) => call.name)).toEqual([CALL_NAMES.getTracks])
  })

  test('a LAN origin plays the file and asks for no bitrate, whatever the server says of outside', async () => {
    const { sources, opened, made } = setup({ answer: OVER, origin: LAN, remote: HELD })
    await sources.resolve(SOURCE)
    expect(opened.map(({ media }) => media)).toEqual([FILE])
    expect(made.map(({ call }) => call.name)).toEqual([CALL_NAMES.getTracks])
  })

  test('a file under the limit, or one of no known bitrate, plays as it is', async () => {
    const under = setup({ answer: answerOf({ bitrate: 3_000_000 }), origin: PUBLIC, remote: HELD })
    await under.sources.resolve(SOURCE)
    const unknown = setup({ answer: answerOf({ bitrate: null }), origin: PUBLIC, remote: HELD })
    await unknown.sources.resolve(SOURCE)
    expect([...under.opened, ...unknown.opened].map(({ media }) => media)).toEqual([FILE, FILE])
  })

  test('no limit, or a server that says nothing of remote play, plays the file with no call more', async () => {
    const none = setup({ answer: OVER, origin: PUBLIC, remote: { limit: null, isOutside: true } })
    await none.sources.resolve(SOURCE)
    const older = setup({ answer: OVER, origin: PUBLIC })
    await older.sources.resolve(SOURCE)
    expect([...none.opened, ...older.opened].map(({ media }) => media)).toEqual([FILE, FILE])
    expect([...none.made, ...older.made].map(({ call }) => call.name)).toEqual([
      CALL_NAMES.getTracks,
      CALL_NAMES.getTracks,
    ])
  })

  test('a bitrate the server does not give plays the file, with a warning', async () => {
    const { sources, opened, warnings } = setup({
      answer: (call) =>
        call.name === CALL_NAMES.getMedia
          ? reply({ status: 500, body: '' })
          : reply({ status: 200, body: JSON.stringify(TRACKS) }),
      origin: PUBLIC,
      remote: HELD,
    })
    await sources.resolve(SOURCE)
    expect(opened.map(({ media }) => media)).toEqual([FILE])
    expect(warnings).toEqual(["raven did not say a title's bitrate, so it plays its file"])
  })

  test('a bitrate that does not come in time plays the file', async () => {
    jest.useFakeTimers()
    try {
      const { sources, opened } = setup({
        answer: (call) =>
          call.name === CALL_NAMES.getMedia
            ? null
            : reply({ status: 200, body: JSON.stringify(TRACKS) }),
        origin: PUBLIC,
        remote: HELD,
      })
      const resolving = sources.resolve(SOURCE)
      // The bitrate is asked for once the pick is in, a few turns after the resolve began.
      await Array.from({ length: 10 }).reduce<Promise<void>>(
        (turns) => turns.then(() => undefined),
        Promise.resolve(),
      )
      jest.advanceTimersByTime(MEDIA_TIMEOUT_MS)
      await resolving
      expect(opened.map(({ media }) => media)).toEqual([FILE])
    } finally {
      jest.useRealTimers()
    }
  })

  test('a track away from home stays its file or its own transcode', async () => {
    const { sources, opened, made } = setup({ answer: OVER, origin: PUBLIC, remote: HELD })
    await sources.resolveTrack({ mediaId: 8, kbps: null })
    await sources.resolveTrack({ mediaId: 8, kbps: 256 })
    expect(opened.map(({ media }) => media)).toEqual([
      FILE,
      { kind: RELAYED_MEDIA_KINDS.audio, kbps: 256 },
    ])
    expect(made).toEqual([])
  })
})
