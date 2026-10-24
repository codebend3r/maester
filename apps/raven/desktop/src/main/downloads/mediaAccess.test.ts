import {
  AUTH_REFUSALS,
  MEDIA_ORIGIN_KINDS,
  MEDIA_PROBE_BYTES,
  MEDIA_PROBE_TIMEOUT_MS,
  type MediaOrigin,
} from '@raven/core'
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
  type ProbeFetch,
  ACCESS_REFUSALS,
} from '@/main/downloads/mediaAccess'
import { TICKET_OUTCOMES, type TicketOutcome } from '@/main/servers/accountTickets'
import { CALL_MESSAGES } from '@/main/servers/serverCalls'
import { ticks } from '@/main/test/downloadFakes'
import { fakeTimers } from '@/main/test/playerFakes'
import { fakeCalls, keyOf, ok, type Reply } from '@/main/test/serverFakes'

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
const LAN_TWO: MediaOrigin = { kind: 'lan', url: 'http://192.168.1.6:3000' }
const TAILNET: MediaOrigin = { kind: 'tailnet', url: 'http://vhagar.tail.ts.net:3000' }
const PUBLIC: MediaOrigin = { kind: 'public', url: 'https://media.example.com' }

const originsCall = keyOf({ name: CALL_NAMES.getMediaOrigins })
const pingOf = (origin: MediaOrigin): string =>
  `${origin.url}/api/media-origins/ping?bytes=${MEDIA_PROBE_BYTES}`

const TICKET = 'account.one'

const succeeded = (outcome: AccessOutcome): Access => {
  if (!outcome.ok) throw new Error(`expected ok, got ${outcome.reason}`)
  return outcome.access
}

const failed = (outcome: AccessOutcome) => {
  if (outcome.ok) throw new Error('expected a refusal')
  return outcome
}

/**
 * How one origin answers its ping. The first chunk lands `firstByteMs` after the probe starts and
 * the rest at `bytesPerSecond`; `isBroken` errors the body after its first chunk, as the timeout
 * firing mid-read does.
 */
type PingAnswer = {
  firstByteMs?: number
  bytesPerSecond?: number
  bytes?: number
  status?: number
  isBroken?: boolean
}

const FIRST_CHUNK_BYTES = 16_384

/**
 * Ping answers timed on one fake clock. Every wait is released in time order, one a macrotask, so
 * probes that run at once each measure only their own times. An origin with no answer rejects, as
 * a probe that fails to connect does.
 */
const pingNetwork = (answers: Record<string, PingAnswer>) => {
  let time = 0
  let waits: { at: number; release: () => void }[] = []
  let isDriving = false
  const asked: { url: string; timeoutMs: number; at: number }[] = []

  const step = (): void => {
    const [next, ...rest] = waits.toSorted((a, b) => a.at - b.at)
    if (next === undefined) {
      isDriving = false
      return
    }
    waits = rest
    time = next.at
    next.release()
    setTimeout(step, 0)
  }

  const until = (at: number): Promise<void> =>
    new Promise((resolve) => {
      waits = [...waits, { at, release: resolve }]
      if (isDriving) return
      isDriving = true
      setTimeout(step, 0)
    })

  const bodyOf = ({ answer, startedAt }: { answer: PingAnswer; startedAt: number }) => {
    const bytes = answer.bytes ?? MEDIA_PROBE_BYTES
    const firstAt = startedAt + (answer.firstByteMs ?? 10)
    const lastAt = firstAt + (bytes / (answer.bytesPerSecond ?? 50 * MB)) * 1000
    const firstBytes = Math.min(FIRST_CHUNK_BYTES, bytes)
    const parts = [
      { at: firstAt, size: firstBytes },
      { at: lastAt, size: bytes - firstBytes },
    ].filter((part) => part.size > 0)
    let sent = 0
    return new ReadableStream<Uint8Array>({
      pull: async (controller) => {
        if (sent > 0 && answer.isBroken === true) throw new Error('The operation was aborted')
        const part = parts[sent]
        if (part === undefined) return controller.close()
        sent += 1
        await until(part.at)
        controller.enqueue(new Uint8Array(part.size))
      },
    })
  }

  const probe: ProbeFetch = async ({ url, timeoutMs }) => {
    asked.push({ url, timeoutMs, at: time })
    const answer = Object.entries(answers).find(([prefix]) => url.startsWith(prefix))?.[1] ?? null
    if (answer === null) throw new Error('timed out')
    const status = answer.status ?? 200
    return { ok: status >= 200 && status < 300, body: bodyOf({ answer, startedAt: time }) }
  }

  return { probe, clock: () => time, asked }
}

const run = ({
  replies,
  answers,
  server = SERVER,
  now = 0,
  minted = () => ({ kind: TICKET_OUTCOMES.ticket, ticket: TICKET }),
}: {
  replies: Record<string, Reply>
  answers: Record<string, PingAnswer>
  server?: ServerEntry | null
  now?: number
  /** What each account ticket mint answers. */
  minted?: () => TicketOutcome
}) => {
  const { calls, log } = fakeCalls(replies)
  const network = pingNetwork(answers)
  const warnings: string[] = []
  const mints: { serverId: string; mediaId: number; isFresh: boolean }[] = []
  const clock = { now }
  const { timers, pending } = fakeTimers()
  const access = createMediaAccess({
    calls,
    serverOf: (serverId) => (server !== null && serverId === server.id ? server : null),
    probe: network.probe,
    probeClock: network.clock,
    now: () => clock.now,
    timers,
    tickets: {
      ticketFor: async (input) => {
        mints.push(input)
        return minted()
      },
    },
    warn: (message) => {
      warnings.push(message)
    },
  })
  return { access, log, warnings, asked: network.asked, mints, clock, pending }
}

const withOrigins = (origins: MediaOrigin[]): Record<string, Reply> => ({
  [originsCall]: ok({ origins }),
})

const pickedFrom = async ({
  origins,
  answers,
}: {
  origins: MediaOrigin[]
  answers: Record<string, PingAnswer>
}): Promise<Access> => {
  const { access } = run({ replies: withOrigins(origins), answers })
  return succeeded(await access.accessFor({ serverId: SERVER_ID, mediaId: 7, signal: LIVE }))
}

describe('the pick', () => {
  it('takes a tailnet origin over a lan one far slower than it', async () => {
    const picked = await pickedFrom({
      origins: [LAN, TAILNET],
      answers: {
        [LAN.url]: { firstByteMs: 5, bytesPerSecond: 1 * MB },
        [TAILNET.url]: { firstByteMs: 5, bytesPerSecond: 20 * MB },
      },
    })
    expect(picked).toEqual({ url: TAILNET.url, ticket: TICKET })
  })

  it('takes the nearer kind when it is a little slower', async () => {
    const picked = await pickedFrom({
      origins: [PUBLIC, TAILNET, LAN],
      answers: {
        [PUBLIC.url]: { firstByteMs: 5, bytesPerSecond: 10 * MB },
        [TAILNET.url]: { firstByteMs: 5, bytesPerSecond: 10 * MB },
        [LAN.url]: { firstByteMs: 5, bytesPerSecond: 9 * MB },
      },
    })
    expect(picked.url).toBe(LAN.url)
  })

  it('counts a slow first byte against an origin', async () => {
    const picked = await pickedFrom({
      origins: [LAN, PUBLIC],
      answers: {
        [LAN.url]: { firstByteMs: 400, bytesPerSecond: 10 * MB },
        [PUBLIC.url]: { firstByteMs: 5, bytesPerSecond: 10 * MB },
      },
    })
    expect(picked.url).toBe(PUBLIC.url)
  })

  it('takes the quicker first byte between two of a kind inside the band', async () => {
    const picked = await pickedFrom({
      origins: [LAN, LAN_TWO],
      answers: {
        [LAN.url]: { firstByteMs: 12, bytesPerSecond: 10 * MB },
        [LAN_TWO.url]: { firstByteMs: 6, bytesPerSecond: 10 * MB },
      },
    })
    expect(picked.url).toBe(LAN_TWO.url)
  })

  it('leaves out a probe that fails, answers non-2xx, breaks off or ends short', async () => {
    const picked = await pickedFrom({
      origins: [LAN, LAN_TWO, TAILNET, { kind: 'tailnet', url: 'http://10.1.1.1:3000' }, PUBLIC],
      answers: {
        [LAN_TWO.url]: { status: 503 },
        [TAILNET.url]: { isBroken: true },
        'http://10.1.1.1:3000': { bytes: MEDIA_PROBE_BYTES - 1 },
        [PUBLIC.url]: { firstByteMs: 80, bytesPerSecond: 2 * MB },
      },
    })
    expect(picked.url).toBe(PUBLIC.url)
  })

  it("uses the server's own origin when no probe scores", async () => {
    const picked = await pickedFrom({
      origins: [LAN, LAN_TWO, TAILNET, PUBLIC],
      answers: {
        [LAN_TWO.url]: { status: 500 },
        [TAILNET.url]: { isBroken: true },
        [PUBLIC.url]: { bytes: 0 },
      },
    })
    expect(picked).toEqual({ url: SERVER.origin, ticket: TICKET })
  })
})

describe('createMediaAccess', () => {
  it("uses the server's own origin, without probing, when no origin is listed", async () => {
    const { access, log, asked } = run({ replies: withOrigins([]), answers: {} })
    const outcome = await access.accessFor({ serverId: SERVER_ID, mediaId: 7, signal: LIVE })
    expect(succeeded(outcome)).toEqual({ url: SERVER.origin, ticket: TICKET })
    expect(asked).toEqual([])
    expect(log).toEqual([originsCall])
  })

  it('starts every probe before any answers, each with the brief timeout', async () => {
    const { access, asked } = run({
      replies: withOrigins([PUBLIC, LAN]),
      answers: { [PUBLIC.url]: { firstByteMs: 10 }, [LAN.url]: { firstByteMs: 12 } },
    })
    expect(
      succeeded(await access.accessFor({ serverId: SERVER_ID, mediaId: 7, signal: LIVE })),
    ).toEqual({ url: LAN.url, ticket: TICKET })
    expect(asked).toEqual([
      { url: pingOf(PUBLIC), timeoutMs: MEDIA_PROBE_TIMEOUT_MS, at: 0 },
      { url: pingOf(LAN), timeoutMs: MEDIA_PROBE_TIMEOUT_MS, at: 0 },
    ])
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

  it('reads the origins once per server across two files, and probes once', async () => {
    const { access, log, asked } = run({ replies: withOrigins([LAN]), answers: { [LAN.url]: {} } })
    await Promise.all([
      access.accessFor({ serverId: SERVER_ID, mediaId: 7, signal: LIVE }),
      access.accessFor({ serverId: SERVER_ID, mediaId: 8, signal: LIVE }),
    ])
    await access.accessFor({ serverId: SERVER_ID, mediaId: 7, signal: LIVE })
    expect(log.filter((key) => key === originsCall)).toHaveLength(1)
    expect(asked).toHaveLength(1)
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

  it('uses the server origin, naming no URL in the log, on a bad origins body', async () => {
    const { access, warnings, asked } = run({
      replies: {
        [originsCall]: ok({ origins: [{ kind: 'lan', url: 'http://secret.example:3000' }, 7] }),
      },
      answers: {},
    })
    const outcome = await access.accessFor({ serverId: SERVER_ID, mediaId: 7, signal: LIVE })
    expect(succeeded(outcome).url).toBe(SERVER.origin)
    expect(asked).toEqual([])
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain('Vhagar')
    expect(warnings.join(' ')).not.toContain('secret.example')
  })

  it('uses the server origin, warning once, when the origins read fails', async () => {
    const { access, warnings } = run({
      replies: { [originsCall]: { unreachable: 'http://10.0.0.1 refused' } },
      answers: {},
    })
    const outcome = await access.accessFor({ serverId: SERVER_ID, mediaId: 7, signal: LIVE })
    expect(succeeded(outcome).url).toBe(SERVER.origin)
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).not.toContain('10.0.0.1')
  })

  it('drops origins that are not plain http or https, probing none of them', async () => {
    const hostile: MediaOrigin[] = [
      { kind: 'lan', url: 'file:///etc/hosts?' },
      { kind: 'tailnet', url: '/relative' },
      { kind: 'public', url: 'javascript:alert(1)' },
      { kind: 'lan', url: 'http://user:pass@192.168.1.9:3000' },
    ]
    const { access, warnings, asked } = run({ replies: withOrigins(hostile), answers: {} })
    const outcome = await access.accessFor({ serverId: SERVER_ID, mediaId: 7, signal: LIVE })
    expect(succeeded(outcome).url).toBe(SERVER.origin)
    expect(asked).toEqual([])
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain('Vhagar')
    expect(warnings[0]).toContain('lan, tailnet, public, lan')
    expect(warnings.join(' ')).not.toMatch(/etc|relative|javascript|pass/u)
  })

  it('keeps a trusted origin beside a dropped one', async () => {
    const { access, asked } = run({
      replies: withOrigins([{ kind: 'lan', url: 'file:///etc/hosts?' }, LAN]),
      answers: { [LAN.url]: {} },
    })
    const outcome = await access.accessFor({ serverId: SERVER_ID, mediaId: 7, signal: LIVE })
    expect(succeeded(outcome).url).toBe(LAN.url)
    expect(asked).toHaveLength(1)
  })

  it('cuts an origin with a path, query or trailing slash down to its origin', async () => {
    const { access, asked } = run({
      replies: withOrigins([{ kind: 'lan', url: `${LAN.url}/base/?x=1#h` }]),
      answers: { [LAN.url]: {} },
    })
    const outcome = await access.accessFor({ serverId: SERVER_ID, mediaId: 7, signal: LIVE })
    expect(asked.map((entry) => entry.url)).toEqual([
      `${LAN.url}/api/media-origins/ping?bytes=${MEDIA_PROBE_BYTES}`,
    ])
    expect(succeeded(outcome).url).toBe(LAN.url)
  })

  it('treats an origins call that rejects as a failed read, and does not hold the rejection', async () => {
    const network = pingNetwork({})
    const warnings: string[] = []
    const access = createMediaAccess({
      calls: {
        call: async () => {
          throw new Error('boom http://10.0.0.1')
        },
      },
      serverOf: () => SERVER,
      probe: network.probe,
      probeClock: network.clock,
      now: () => 0,
      timers: fakeTimers().timers,
      tickets: { ticketFor: async () => ({ kind: TICKET_OUTCOMES.ticket, ticket: TICKET }) },
      warn: (message) => {
        warnings.push(message)
      },
    })
    const accessed = async () =>
      succeeded(await access.accessFor({ serverId: SERVER_ID, mediaId: 7, signal: LIVE }))
    expect((await accessed()).url).toBe(SERVER.origin)
    expect((await accessed()).url).toBe(SERVER.origin)
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).not.toContain('10.0.0.1')
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
    const { calls } = fakeCalls(withOrigins([]))
    const { timers, pending } = fakeTimers()
    const servers = [SERVER, other]
    const access = createMediaAccess({
      calls,
      serverOf: (serverId) => servers.find((server) => server.id === serverId) ?? null,
      probe: pingNetwork({}).probe,
      probeClock: () => 0,
      now: () => NOW,
      timers,
      tickets: { ticketFor: async () => ({ kind: TICKET_OUTCOMES.ticket, ticket: TICKET }) },
      warn: () => undefined,
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
  it('puts the encoded ticket on the origin it was read for', () => {
    const access: Access = { url: LAN.url, ticket: 'a b/c+d=' }
    expect(fileUrlFor({ access, mediaId: 7 })).toBe(
      `${LAN.url}/api/media/7/file?t=${encodeURIComponent('a b/c+d=')}`,
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
