import { afterEach, describe, expect, jest, test } from 'bun:test'
import {
  AUTH_REFUSALS,
  type MediaTracks,
  PLAYER_ERROR_REASONS,
  PLAYER_SOURCE_KINDS,
  type SubtitleTrack,
} from '@raven/core'
import type { ServerEntry } from '@/main/desktopConfig'
import { PLAYER_MESSAGES, type ServerTarget, PLAYER_PHASES } from '@/main/player/playerService'
import { TICKET_OUTCOMES, type TicketOutcome } from '@/main/servers/accountTickets'
import { CALL_NAMES, type AllowedCall } from '@/main/servers/allowlist'
import type { MediaRelay } from '@/main/servers/mediaRelay'
import type { ServerCallResult } from '@/main/servers/serverCalls'
import {
  createServerSources,
  EXPLAIN_TIMEOUT_MS,
  SOURCE_MESSAGES,
  TRACKS_TIMEOUT_MS,
} from '@/main/servers/serverSources'

const SERVER: ServerEntry = {
  id: '00000000-0000-4000-8000-000000000001',
  origin: 'https://raven.example',
  name: 'Vhagar',
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

const reply = ({ status, body }: { status: number; body: string }): ServerCallResult => ({
  ok: true,
  status,
  body,
})

/** Calls answered by `answer`, or held until the test settles them when it gives null. */
const fakeCalls = ({ answer }: { answer: (call: AllowedCall) => ServerCallResult | null }) => {
  const made: { serverId: string; call: AllowedCall }[] = []
  const calls = {
    call: ({ serverId, call }: { serverId: string; call: AllowedCall }) => {
      made.push({ serverId, call })
      const answered = answer(call)
      if (answered === null) return new Promise<ServerCallResult>(() => {})
      return Promise.resolve(answered)
    },
  }
  return { calls, made }
}

const RELAY_BASE = `http://127.0.0.1:4000/${'s'.repeat(43)}`

/** A relay that answers fixed URLs, keeping what it was asked. */
const fakeRelay = ({
  refusal = null,
  isOpenFailing = false,
}: {
  refusal?: ReturnType<MediaRelay['refusalOf']>
  isOpenFailing?: boolean
}) => {
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

const setup = ({
  answer = () => reply({ status: 200, body: JSON.stringify(TRACKS) }),
  servers = [SERVER],
  ticket = { kind: TICKET_OUTCOMES.ticket, ticket: 'account.t1' },
  refusal = null,
  isOpenFailing = false,
}: {
  answer?: (call: AllowedCall) => ServerCallResult | null
  servers?: readonly ServerEntry[]
  ticket?: TicketOutcome
  refusal?: ReturnType<MediaRelay['refusalOf']>
  isOpenFailing?: boolean
} = {}) => {
  const { calls, made } = fakeCalls({ answer })
  const warnings: string[] = []
  const minted: { serverId: string; mediaId: number; isFresh: boolean }[] = []
  const order: string[] = []
  const relayed = fakeRelay({ refusal, isOpenFailing })
  const sources = createServerSources({
    serverOf: (serverId) => servers.find((server) => server.id === serverId) ?? null,
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
    warn: (message) => {
      warnings.push(message)
    },
  })
  return { sources, made, warnings, minted, order, ...relayed }
}

const RELAYED_TARGET: ServerTarget = {
  kind: PLAYER_SOURCE_KINDS.server,
  serverId: SERVER.id,
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
        serverId: SERVER.id,
        mediaId: 7,
        url: `${RELAY_BASE}/file`,
        relay: { loadId: '1', base: RELAY_BASE },
        sidecars: [
          { url: `${RELAY_BASE}/subtitles/external-0`, title: 'English SDH', language: 'en' },
          { url: `${RELAY_BASE}/subtitles/external-1`, title: '', language: '' },
        ],
      },
    })
    expect(made).toEqual([
      { serverId: SERVER.id, call: { name: CALL_NAMES.getTracks, mediaId: 7 } },
    ])
    expect(minted).toEqual([{ serverId: SERVER.id, mediaId: 7, isFresh: false }])
    expect(opened).toEqual([
      { server: SERVER, mediaId: 7, sidecarTrackIds: ['external-0', 'external-1'] },
    ])
    expect(order).toEqual(['mint', 'open'])
    expect(warnings).toEqual([])
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
      expect(warnings).toEqual(['no sidecars from Vhagar: its tracks did not answer in time'])
      expect(TRACKS_TIMEOUT_MS).toBe(3000)
    } finally {
      jest.useRealTimers()
    }
  })

  test.each([
    ['a 500', reply({ status: 500, body: '{"message":"boom"}' })],
    ['an HTML page', reply({ status: 200, body: '<html>' })],
    ['a body that is not tracks', reply({ status: 200, body: '{"audio":3}' })],
    ['an unreachable server', { ok: false, message: 'raven player could not reach Vhagar.' }],
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
      serverOf: () => SERVER,
      calls: { call: () => Promise.reject(new Error('gone')) },
      tickets: { ticketFor: async () => ({ kind: TICKET_OUTCOMES.ticket, ticket: 't' }) },
      relay,
      warn: (message) => {
        warnings.push(message)
      },
    })
    const resolved = await sources.resolve(SOURCE)
    if (!resolved.ok || resolved.target.kind !== PLAYER_SOURCE_KINDS.server)
      throw new Error('expected a server')
    expect(resolved.target.sidecars).toEqual([])
    expect(warnings).toEqual(['no sidecars from Vhagar: its tracks failed: gone'])
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

  test('an unknown server is refused and calls nothing', async () => {
    const { sources, made, minted } = setup()
    expect(await sources.resolve({ ...SOURCE, serverId: OTHER_ID })).toEqual({
      ok: false,
      message: SOURCE_MESSAGES.unknownServer,
    })
    expect(made).toEqual([])
    expect(minted).toEqual([])
  })

  test.each([
    [
      'signed out',
      { kind: TICKET_OUTCOMES.refused, reason: AUTH_REFUSALS.signedOut },
      SOURCE_MESSAGES.signIn('Vhagar'),
    ],
    [
      'removed',
      { kind: TICKET_OUTCOMES.refused, reason: AUTH_REFUSALS.revoked },
      SOURCE_MESSAGES.removed('Vhagar'),
    ],
    [
      'awaiting approval',
      { kind: TICKET_OUTCOMES.refused, reason: AUTH_REFUSALS.pending },
      SOURCE_MESSAGES.pending('Vhagar'),
    ],
    ['locked', { kind: TICKET_OUTCOMES.locked }, SOURCE_MESSAGES.relocked('Vhagar')],
    ['gone', { kind: TICKET_OUTCOMES.gone }, SOURCE_MESSAGES.gone('Vhagar')],
    ['unreachable', { kind: TICKET_OUTCOMES.unreachable }, SOURCE_MESSAGES.lost('Vhagar')],
  ] as const)(
    'a title whose ticket is %s is refused before mpv opens anything',
    async (_label, ticket, message) => {
      const { sources, opened } = setup({ ticket })
      expect(await sources.resolve(SOURCE)).toEqual({ ok: false, message })
      expect(opened).toEqual([])
    },
  )

  test('a relay that cannot open is a title raven player could not open, with nothing secret said', async () => {
    const { sources, warnings } = setup({ isOpenFailing: true })
    expect(await sources.resolve(SOURCE)).toEqual({
      ok: false,
      message: SOURCE_MESSAGES.cannotOpen('Vhagar'),
    })
    expect(warnings).toEqual(['raven player could not relay a title from Vhagar'])
  })
})

describe('refusedAccount', () => {
  test("reads the relay's refusal for a relayed title without closing it or asking the server", () => {
    const { sources, closed, made } = setup({ refusal: AUTH_REFUSALS.revoked })
    expect(sources.refusedAccount(RELAYED_TARGET)).toEqual({
      reason: PLAYER_ERROR_REASONS.account,
      message: SOURCE_MESSAGES.removed('Vhagar'),
    })
    expect(closed).toEqual([])
    expect(made).toEqual([])
  })

  test('is null for a load with no refusal and a server gone from the config', () => {
    expect(setup().sources.refusedAccount(RELAYED_TARGET)).toBeNull()
    expect(
      setup({ refusal: AUTH_REFUSALS.revoked, servers: [] }).sources.refusedAccount(RELAYED_TARGET),
    ).toBeNull()
    expect(
      setup({ refusal: AUTH_REFUSALS.unavailable }).sources.refusedAccount(RELAYED_TARGET),
    ).toBeNull()
  })
})

describe('explain', () => {
  afterEach(() => {
    jest.useRealTimers()
  })

  test('asks the server for the title once', async () => {
    const { sources, made } = setup({ answer: () => reply({ status: 200, body: '{}' }) })
    await sources.explain({ target: RELAYED_TARGET, phase: PLAYER_PHASES.loaded })
    expect(made).toEqual([{ serverId: SERVER.id, call: { name: CALL_NAMES.getMedia, mediaId: 7 } }])
  })

  test('an unreachable server lost the connection', async () => {
    const { sources } = setup({
      answer: () => ({ ok: false, message: 'raven player could not reach Vhagar.' }),
    })
    expect(await sources.explain({ target: RELAYED_TARGET, phase: PLAYER_PHASES.loaded })).toEqual({
      reason: 'network',
      message: SOURCE_MESSAGES.lost('Vhagar'),
    })
  })

  test('a call held past the timeout lost the connection', async () => {
    jest.useFakeTimers()
    const { sources } = setup({ answer: () => null })
    const explained = sources.explain({ target: RELAYED_TARGET, phase: PLAYER_PHASES.loading })
    jest.advanceTimersByTime(EXPLAIN_TIMEOUT_MS)
    expect(await explained).toEqual({ reason: 'network', message: SOURCE_MESSAGES.lost('Vhagar') })
    expect(EXPLAIN_TIMEOUT_MS).toBe(5000)
  })

  test('a 423 is the library locked again', async () => {
    const { sources } = setup({ answer: () => reply({ status: 423, body: '{}' }) })
    expect(await sources.explain({ target: RELAYED_TARGET, phase: PLAYER_PHASES.loaded })).toEqual({
      reason: PLAYER_ERROR_REASONS.locked,
      message: 'Vhagar locked this library again.',
    })
  })

  test('a 404 is a title that is gone', async () => {
    const { sources } = setup({ answer: () => reply({ status: 404, body: '{}' }) })
    expect(await sources.explain({ target: RELAYED_TARGET, phase: PLAYER_PHASES.loading })).toEqual(
      {
        reason: PLAYER_ERROR_REASONS.open,
        message: SOURCE_MESSAGES.gone('Vhagar'),
      },
    )
  })

  test('a 200 keeps the reason mpv had, by phase', async () => {
    const { sources } = setup({ answer: () => reply({ status: 200, body: '{}' }) })
    expect(await sources.explain({ target: RELAYED_TARGET, phase: PLAYER_PHASES.loading })).toEqual(
      {
        reason: PLAYER_ERROR_REASONS.open,
        message: SOURCE_MESSAGES.cannotOpen('Vhagar'),
      },
    )
    expect(await sources.explain({ target: RELAYED_TARGET, phase: PLAYER_PHASES.loaded })).toEqual({
      reason: 'decode',
      message: PLAYER_MESSAGES.stopped,
    })
  })

  test('a server gone from the config lost the connection to the server, without a call', async () => {
    const { sources, made } = setup({ servers: [] })
    expect(await sources.explain({ target: RELAYED_TARGET, phase: PLAYER_PHASES.loaded })).toEqual({
      reason: 'network',
      message: SOURCE_MESSAGES.lost('the server'),
    })
    expect(made).toEqual([])
  })

  test("the player's own messages say what the source would", () => {
    expect<string>(PLAYER_MESSAGES.lost).toBe(SOURCE_MESSAGES.lost('the server'))
  })

  test('a relayed load the server refused is read off the relay as removed access', async () => {
    const { sources, made, refusalsAsked, closed } = setup({
      refusal: AUTH_REFUSALS.revoked,
    })
    expect(await sources.explain({ target: RELAYED_TARGET, phase: PLAYER_PHASES.loaded })).toEqual({
      reason: PLAYER_ERROR_REASONS.account,
      message: 'Your access to Vhagar was removed.',
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
        message: SOURCE_MESSAGES.removed('Vhagar'),
      })
    },
  )

  test('a relayed load whose account was signed out asks for a sign in', async () => {
    const { sources } = setup({ refusal: AUTH_REFUSALS.signedOut })
    expect(await sources.explain({ target: RELAYED_TARGET, phase: PLAYER_PHASES.loading })).toEqual(
      {
        reason: PLAYER_ERROR_REASONS.account,
        message: 'Sign in to Vhagar again.',
      },
    )
  })

  test('a relayed load with no refusal asks the server, and closes the load', async () => {
    const { sources, made, closed } = setup({
      answer: () => reply({ status: 423, body: '{}' }),
    })
    expect(await sources.explain({ target: RELAYED_TARGET, phase: PLAYER_PHASES.loaded })).toEqual({
      reason: PLAYER_ERROR_REASONS.locked,
      message: 'Vhagar locked this library again.',
    })
    expect(made).toEqual([{ serverId: SERVER.id, call: { name: CALL_NAMES.getMedia, mediaId: 7 } }])
    expect(closed).toEqual(['1'])
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
      message: SOURCE_MESSAGES.signInAgain('Vhagar'),
    })
  })
})
