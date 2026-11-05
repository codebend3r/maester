import { AUTH_REFUSALS, MEDIA_ORIGIN_KINDS, type MediaOrigin } from '@raven/core'
import { describe, expect, it } from 'bun:test'
import { CALL_NAMES } from '@/main/servers/allowlist'
import { SERVER_GONE, type ServerEntry } from '@/main/desktopConfig'
import { DOWNLOAD_MESSAGES } from '@/main/downloads/downloadMessages'
import { EXPAND_MESSAGES } from '@/main/downloads/expand'
import {
  createMediaAccess,
  DOWNLOAD_MINTS,
  fileUrlFor,
  sidecarUrlFor,
  type Access,
  type AccessOutcome,
  ACCESS_REFUSALS,
} from '@/main/downloads/mediaAccess'
import { TICKET_OUTCOMES, type TicketOutcome } from '@/main/servers/accountTickets'
import { createOriginPicks } from '@/main/servers/originPicks'
import { CALL_MESSAGES } from '@/main/servers/serverCalls'
import { ticks } from '@/main/test/downloadFakes'
import { pingNetwork, type PingAnswer } from '@/main/test/pingNetwork'
import { fakeTimers } from '@/main/test/playerFakes'
import { fakeCalls, fixedPicks, keyOf, ok, type Reply } from '@/main/test/serverFakes'

const SERVER_ID = '6f1c1c0e-3b0a-4f4e-8a55-0d2f3c5b7e11'
const SERVER: ServerEntry = {
  id: SERVER_ID,
  origin: 'https://raven.example',
  name: 'Vhagar',
}

const NOW = 1_700_000_000_000

/** A run nothing stops. */
const LIVE = new AbortController().signal
const MINUTE_MS = 60_000
const MB = 1_000_000

const LAN: MediaOrigin = { kind: 'lan', url: 'http://192.168.1.5:3000' }
const TAILNET: MediaOrigin = { kind: 'tailnet', url: 'http://vhagar.tail.ts.net:3000' }
const PUBLIC: MediaOrigin = { kind: 'public', url: 'https://media.example.com' }

const originsCall = keyOf({ name: CALL_NAMES.getMediaOrigins })

const TICKET = 'account.one'

const succeeded = (outcome: AccessOutcome): Access => {
  if (!outcome.ok) throw new Error(`expected ok, got ${outcome.reason}`)
  return outcome.access
}

const failed = (outcome: AccessOutcome) => {
  if (outcome.ok) throw new Error('expected a refusal')
  return outcome
}

type RunProps = {
  replies: Record<string, Reply>
  answers: Record<string, PingAnswer>
  server?: ServerEntry | null
  now?: number
  /** What each account ticket mint answers. */
  minted?: () => TicketOutcome
}

const run = ({
  replies,
  answers,
  server = SERVER,
  now = 0,
  minted = () => ({ kind: TICKET_OUTCOMES.ticket, ticket: TICKET }),
}: RunProps) => {
  const { calls, log } = fakeCalls(replies)
  const network = pingNetwork(answers)
  const warnings: string[] = []
  const mints: { serverId: string; mediaId: number; isFresh: boolean }[] = []
  const clock = { now }
  const { timers, pending } = fakeTimers()
  const picks = createOriginPicks({
    calls,
    probe: network.probe,
    probeClock: network.clock,
    now: () => clock.now,
    warn: (message) => {
      warnings.push(message)
    },
  })
  const access = createMediaAccess({
    serverOf: (serverId) => (server !== null && serverId === server.id ? server : null),
    picks,
    now: () => clock.now,
    timers,
    tickets: {
      ticketFor: async (input) => {
        mints.push(input)
        return minted()
      },
    },
  })
  return { access, log, warnings, asked: network.asked, mints, clock, pending }
}

const withOrigins = (origins: MediaOrigin[]): Record<string, Reply> => ({
  [originsCall]: ok({ origins }),
})

describe('createMediaAccess', () => {
  it("uses the server's own origin, without probing, when no origin is listed", async () => {
    const { access, log, asked } = run({ replies: withOrigins([]), answers: {} })
    const outcome = await access.accessFor({ serverId: SERVER_ID, mediaId: 7, signal: LIVE })
    expect(succeeded(outcome)).toEqual({ url: SERVER.origin, ticket: TICKET })
    expect(asked).toEqual([])
    expect(log).toEqual([originsCall])
  })

  it('fetches from the media origin picked, a fast lan one over the public address', async () => {
    const { access } = run({
      replies: withOrigins([PUBLIC, LAN]),
      answers: {
        [PUBLIC.url]: { firstByteMs: 60, bytesPerSecond: 0.58 * MB },
        [LAN.url]: { firstByteMs: 3, bytesPerSecond: 10.8 * MB },
      },
    })
    const outcome = await access.accessFor({ serverId: SERVER_ID, mediaId: 7, signal: LIVE })
    expect(succeeded(outcome)).toEqual({ url: LAN.url, ticket: TICKET })
  })

  it("fetches from the server's own origin when the listed origin does not answer", async () => {
    const { access } = run({ replies: withOrigins([LAN]), answers: {} })
    const outcome = await access.accessFor({ serverId: SERVER_ID, mediaId: 7, signal: LIVE })
    expect(succeeded(outcome)).toEqual({ url: SERVER.origin, ticket: TICKET })
  })

  it('mints an account ticket afresh for every run', async () => {
    const { access, mints, log } = run({ replies: withOrigins([LAN]), answers: { [LAN.url]: {} } })
    await access.accessFor({ serverId: SERVER_ID, mediaId: 7, signal: LIVE })
    await access.accessFor({ serverId: SERVER_ID, mediaId: 7, signal: LIVE })
    expect(mints).toEqual([
      { serverId: SERVER_ID, mediaId: 7, isFresh: true },
      { serverId: SERVER_ID, mediaId: 7, isFresh: true },
    ])
    expect(log).toEqual([originsCall])
  })

  it('holds the pick until forget, then reads the origins and probes them again', async () => {
    const answers: Record<string, PingAnswer> = { [LAN.url]: {}, [TAILNET.url]: {} }
    const { access, log, asked } = run({ replies: withOrigins([LAN, TAILNET]), answers })
    const accessed = async () =>
      succeeded(await access.accessFor({ serverId: SERVER_ID, mediaId: 7, signal: LIVE }))
    expect((await accessed()).url).toBe(LAN.url)
    answers[LAN.url] = { status: 503 }
    expect((await accessed()).url).toBe(LAN.url)
    access.forget(SERVER_ID)
    expect((await accessed()).url).toBe(TAILNET.url)
    expect(log.filter((key) => key === originsCall)).toHaveLength(2)
    expect(asked).toHaveLength(4)
  })

  it('answers unreachable for a server that is gone, and mints nothing', async () => {
    const { access, log, mints } = run({ replies: {}, answers: {}, server: null })
    const outcome = failed(
      await access.accessFor({ serverId: SERVER_ID, mediaId: 7, signal: LIVE }),
    )
    expect(outcome).toEqual({ ok: false, reason: 'unreachable', message: SERVER_GONE })
    expect(log).toEqual([])
    expect(mints).toEqual([])
  })

  it.each([
    [AUTH_REFUSALS.signedOut, DOWNLOAD_MESSAGES.signInAgain('Vhagar')],
    [AUTH_REFUSALS.pending, DOWNLOAD_MESSAGES.waiting('Vhagar')],
    [AUTH_REFUSALS.revoked, DOWNLOAD_MESSAGES.removed('Vhagar')],
    [AUTH_REFUSALS.notOwner, DOWNLOAD_MESSAGES.removed('Vhagar')],
  ] as const)('answers an account refused as %s with the account copy', async (reason, message) => {
    const { access } = run({
      replies: withOrigins([]),
      answers: {},
      minted: () => ({ kind: TICKET_OUTCOMES.refused, reason }),
    })
    expect(
      failed(await access.accessFor({ serverId: SERVER_ID, mediaId: 7, signal: LIVE })),
    ).toEqual({ ok: false, reason: ACCESS_REFUSALS.account, message })
  })

  it.each([
    [
      'accounts unavailable',
      { kind: TICKET_OUTCOMES.refused, reason: AUTH_REFUSALS.unavailable },
      ACCESS_REFUSALS.unreachable,
      CALL_MESSAGES.unreachable('Vhagar'),
    ],
    [
      ACCESS_REFUSALS.unreachable,
      { kind: TICKET_OUTCOMES.unreachable },
      ACCESS_REFUSALS.unreachable,
      CALL_MESSAGES.unreachable('Vhagar'),
    ],
    [
      ACCESS_REFUSALS.locked,
      { kind: TICKET_OUTCOMES.locked },
      ACCESS_REFUSALS.locked,
      DOWNLOAD_MESSAGES.relocked('Vhagar'),
    ],
    ['gone', { kind: TICKET_OUTCOMES.gone }, ACCESS_REFUSALS.gone, EXPAND_MESSAGES.gone('Vhagar')],
  ] as const)('answers a mint that is %s', async (_name, outcome, reason, message) => {
    const { access } = run({ replies: withOrigins([]), answers: {}, minted: () => outcome })
    expect(
      failed(await access.accessFor({ serverId: SERVER_ID, mediaId: 7, signal: LIVE })),
    ).toEqual({ ok: false, reason, message })
  })

  it('mints at most the budget in five minutes, then waits for the oldest to age out', async () => {
    const { access, mints, clock, pending } = run({
      replies: withOrigins([]),
      answers: {},
      now: NOW,
    })
    await Promise.all(
      Array.from({ length: DOWNLOAD_MINTS.budget }, (_, index) =>
        access.accessFor({ serverId: SERVER_ID, mediaId: index + 1, signal: LIVE }),
      ),
    )
    clock.now += MINUTE_MS
    const waiting = access.accessFor({ serverId: SERVER_ID, mediaId: 99, signal: LIVE })
    await ticks(5)
    expect(mints).toHaveLength(DOWNLOAD_MINTS.budget)
    expect([...pending.values()].map(({ ms }) => ms)).toEqual([DOWNLOAD_MINTS.windowMs - MINUTE_MS])
    clock.now += DOWNLOAD_MINTS.windowMs - MINUTE_MS
    ;[...pending.values()].forEach(({ run: wake }) => wake())
    expect(succeeded(await waiting).ticket).toBe(TICKET)
    expect(mints).toHaveLength(DOWNLOAD_MINTS.budget + 1)
    expect(DOWNLOAD_MINTS).toEqual({ budget: 16, windowMs: 300_000 })
  })

  // The queue's read after a 401 is another read of the same title, so it is counted like this one.
  it('counts every read toward the budget, another read of the same title too', async () => {
    const { access, mints, pending } = run({ replies: withOrigins([]), answers: {} })
    await Array.from({ length: DOWNLOAD_MINTS.budget }).reduce<Promise<unknown>>(
      (previous) =>
        previous.then(() => access.accessFor({ serverId: SERVER_ID, mediaId: 7, signal: LIVE })),
      Promise.resolve(),
    )
    access.accessFor({ serverId: SERVER_ID, mediaId: 7, signal: LIVE }).catch(() => undefined)
    await ticks(5)
    expect(mints).toHaveLength(DOWNLOAD_MINTS.budget)
    expect(pending.size).toBe(1)
  })

  it('mints nothing for a run stopped while it waits on the budget', async () => {
    const { access, mints, pending, clock } = run({ replies: withOrigins([]), answers: {} })
    await Promise.all(
      Array.from({ length: DOWNLOAD_MINTS.budget }, (_, index) =>
        access.accessFor({ serverId: SERVER_ID, mediaId: index + 1, signal: LIVE }),
      ),
    )
    const stop = new AbortController()
    const waiting = access.accessFor({ serverId: SERVER_ID, mediaId: 99, signal: stop.signal })
    await ticks(5)
    stop.abort()
    await waiting
    expect(pending.size).toBe(0)
    clock.now += DOWNLOAD_MINTS.windowMs
    expect(mints).toHaveLength(DOWNLOAD_MINTS.budget)
  })

  it('keeps a budget for each server of its own', async () => {
    const other: ServerEntry = { ...SERVER, id: '7c9e6679-7425-40de-944b-e07fc1f90ae7' }
    const { timers, pending } = fakeTimers()
    const servers = [SERVER, other]
    const access = createMediaAccess({
      serverOf: (serverId) => servers.find((server) => server.id === serverId) ?? null,
      picks: fixedPicks().picks,
      now: () => NOW,
      timers,
      tickets: { ticketFor: async () => ({ kind: TICKET_OUTCOMES.ticket, ticket: TICKET }) },
    })
    await Promise.all(
      Array.from({ length: DOWNLOAD_MINTS.budget }, (_, index) =>
        access.accessFor({ serverId: SERVER_ID, mediaId: index + 1, signal: LIVE }),
      ),
    )
    expect(
      succeeded(await access.accessFor({ serverId: other.id, mediaId: 1, signal: LIVE })).ticket,
    ).toBe(TICKET)
    expect(pending.size).toBe(0)
  })

  it('names no ticket in the log', async () => {
    const { access, warnings } = run({
      replies: {
        [originsCall]: ok({ origins: [{ kind: MEDIA_ORIGIN_KINDS.lan, url: 'ftp://x' }] }),
      },
      answers: {},
    })
    await access.accessFor({ serverId: SERVER_ID, mediaId: 7, signal: LIVE })
    expect(warnings.join('\n')).not.toContain(TICKET)
  })
})

describe('fileUrlFor', () => {
  it('puts the encoded ticket and the download purpose on the origin it was read for', () => {
    const access: Access = { url: LAN.url, ticket: 'a b/c+d=' }
    expect(fileUrlFor({ access, mediaId: 7 })).toBe(
      `${LAN.url}/api/media/7/file?t=${encodeURIComponent('a b/c+d=')}&purpose=download`,
    )
  })

  it('refuses a media id that is not one', () => {
    expect(() => fileUrlFor({ access: { url: LAN.url, ticket: 't' }, mediaId: 0 })).toThrow(
      RangeError,
    )
  })
})

describe('sidecarUrlFor', () => {
  it("shares the file's ticket", () => {
    const access: Access = { url: LAN.url, ticket: 'account.a b' }
    expect(sidecarUrlFor({ access, mediaId: 7, trackId: 'external-3' })).toBe(
      `${LAN.url}/api/media/7/subtitles/external-3?t=account.a%20b`,
    )
  })

  it('refuses an embedded track and a bad media id', () => {
    const access: Access = { url: LAN.url, ticket: 't' }
    expect(() => sidecarUrlFor({ access, mediaId: 7, trackId: 'embedded-0' })).toThrow(RangeError)
    expect(() => sidecarUrlFor({ access, mediaId: -1, trackId: 'external-0' })).toThrow(RangeError)
  })
})
