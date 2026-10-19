import { describe, expect, it } from 'bun:test'
import {
  LOCKED_STATUS,
  MEDIA_PROBE_BYTES,
  MEDIA_TICKET_REFRESH_SECONDS,
  MEDIA_TICKET_SECONDS,
  type MediaOrigin,
} from '@raven/core'
import type { ServerEntry } from '@/main/desktopConfig'
import { DOWNLOAD_MESSAGES } from '@/main/downloads/downloadMessages'
import { EXPAND_MESSAGES } from '@/main/downloads/expand'
import {
  createMediaAccess,
  fileUrlFor,
  PROBE_TIMEOUT_MS,
  sidecarUrlFor,
  TICKET_RENEW_MS,
  type Access,
  type AccessOutcome,
  type ProbeFetch,
} from '@/main/downloads/mediaAccess'
import { CALL_MESSAGES } from '@/main/servers/serverCalls'
import { fakeCalls, keyOf, ok, type Reply } from '@/main/test/serverFakes'
import { SERVER_GONE } from '@/shared/protocol'

const SERVER_ID = '6f1c1c0e-3b0a-4f4e-8a55-0d2f3c5b7e11'
const SERVER: ServerEntry = {
  id: SERVER_ID,
  origin: 'https://raven.example',
  name: 'Vhagar',
  addedAt: 0,
}

const NOW = 1_700_000_000_000
const HOUR_MS = 3_600_000
const MB = 1_000_000

const LAN: MediaOrigin = { kind: 'lan', url: 'http://192.168.1.5:3000' }
const LAN_TWO: MediaOrigin = { kind: 'lan', url: 'http://192.168.1.6:3000' }
const TAILNET: MediaOrigin = { kind: 'tailnet', url: 'http://vhagar.tail.ts.net:3000' }
const PUBLIC: MediaOrigin = { kind: 'public', url: 'https://media.example.com' }

const originsCall = keyOf({ name: 'getMediaOrigins' })
const ticketCall = (mediaId: number): string => keyOf({ name: 'getMediaTicket', mediaId })
const pingOf = (origin: MediaOrigin): string =>
  `${origin.url}/api/media-origins/ping?bytes=${MEDIA_PROBE_BYTES}`

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
}: {
  replies: Record<string, Reply>
  answers: Record<string, PingAnswer>
  server?: ServerEntry | null
  now?: number
}) => {
  const { calls, log } = fakeCalls(replies)
  const network = pingNetwork(answers)
  const warnings: string[] = []
  const access = createMediaAccess({
    calls,
    serverOf: (serverId) => (server !== null && serverId === server.id ? server : null),
    probe: network.probe,
    probeClock: network.clock,
    now: () => now,
    warn: (message) => {
      warnings.push(message)
    },
  })
  return { access, log, warnings, asked: network.asked }
}

const withOrigins = (origins: MediaOrigin[]): Record<string, Reply> => ({
  [originsCall]: ok({ origins }),
  [ticketCall(7)]: ok({ ticket: 'tkt', expiresAt: 1_000 }),
})

const pickedFrom = async ({
  origins,
  answers,
}: {
  origins: MediaOrigin[]
  answers: Record<string, PingAnswer>
}): Promise<Access> => {
  const { access } = run({ replies: withOrigins(origins), answers })
  return succeeded(await access.accessFor({ serverId: SERVER_ID, mediaId: 7 }))
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
    expect(picked).toMatchObject({ kind: 'origin', url: TAILNET.url })
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
    expect(picked).toMatchObject({ kind: 'origin', url: LAN.url })
  })

  it('counts a slow first byte against an origin', async () => {
    const picked = await pickedFrom({
      origins: [LAN, PUBLIC],
      answers: {
        [LAN.url]: { firstByteMs: 400, bytesPerSecond: 10 * MB },
        [PUBLIC.url]: { firstByteMs: 5, bytesPerSecond: 10 * MB },
      },
    })
    expect(picked).toMatchObject({ kind: 'origin', url: PUBLIC.url })
  })

  it('takes the quicker first byte between two of a kind inside the band', async () => {
    const picked = await pickedFrom({
      origins: [LAN, LAN_TWO],
      answers: {
        [LAN.url]: { firstByteMs: 12, bytesPerSecond: 10 * MB },
        [LAN_TWO.url]: { firstByteMs: 6, bytesPerSecond: 10 * MB },
      },
    })
    expect(picked).toMatchObject({ kind: 'origin', url: LAN_TWO.url })
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
    expect(picked).toMatchObject({ kind: 'origin', url: PUBLIC.url })
  })

  it('answers the cookie path, reading no ticket, when no probe scores', async () => {
    const { access, log } = run({
      replies: withOrigins([LAN, LAN_TWO, TAILNET, PUBLIC]),
      answers: {
        [LAN_TWO.url]: { status: 500 },
        [TAILNET.url]: { isBroken: true },
        [PUBLIC.url]: { bytes: 0 },
      },
    })
    const outcome = await access.accessFor({ serverId: SERVER_ID, mediaId: 7 })
    expect(succeeded(outcome)).toEqual({ kind: 'cookie' })
    expect(log).toEqual([originsCall])
  })
})

describe('createMediaAccess', () => {
  it('answers the cookie path, without probing, when no origin is listed', async () => {
    const { access, log, asked } = run({ replies: withOrigins([]), answers: {} })
    const outcome = await access.accessFor({ serverId: SERVER_ID, mediaId: 7 })
    expect(succeeded(outcome)).toEqual({ kind: 'cookie' })
    expect(asked).toEqual([])
    expect(log).toEqual([originsCall])
  })

  it('starts every probe before any answers, each with the brief timeout', async () => {
    const { access, asked } = run({
      replies: withOrigins([PUBLIC, LAN]),
      answers: { [PUBLIC.url]: { firstByteMs: 10 }, [LAN.url]: { firstByteMs: 12 } },
    })
    expect(succeeded(await access.accessFor({ serverId: SERVER_ID, mediaId: 7 }))).toEqual({
      kind: 'origin',
      url: LAN.url,
      ticket: 'tkt',
      renewAt: TICKET_RENEW_MS,
    })
    expect(PROBE_TIMEOUT_MS).toBe(2000)
    expect(asked).toEqual([
      { url: pingOf(PUBLIC), timeoutMs: PROBE_TIMEOUT_MS, at: 0 },
      { url: pingOf(LAN), timeoutMs: PROBE_TIMEOUT_MS, at: 0 },
    ])
  })

  it('answers the cookie path, reading no ticket, when every probe fails', async () => {
    const { access, log } = run({ replies: withOrigins([LAN, PUBLIC]), answers: {} })
    const outcome = await access.accessFor({ serverId: SERVER_ID, mediaId: 7 })
    expect(succeeded(outcome)).toEqual({ kind: 'cookie' })
    expect(log).toEqual([originsCall])
  })

  it('reads a fresh ticket on every call', async () => {
    const { access, log } = run({ replies: withOrigins([LAN]), answers: { [LAN.url]: {} } })
    await access.accessFor({ serverId: SERVER_ID, mediaId: 7 })
    await access.accessFor({ serverId: SERVER_ID, mediaId: 7 })
    expect(log.filter((key) => key === ticketCall(7))).toHaveLength(2)
  })

  it('reads the origins once per server across two files, and probes once', async () => {
    const { access, log, asked } = run({
      replies: { ...withOrigins([LAN]), [ticketCall(8)]: ok({ ticket: 'two', expiresAt: 5 }) },
      answers: { [LAN.url]: {} },
    })
    await Promise.all([
      access.accessFor({ serverId: SERVER_ID, mediaId: 7 }),
      access.accessFor({ serverId: SERVER_ID, mediaId: 8 }),
    ])
    await access.accessFor({ serverId: SERVER_ID, mediaId: 7 })
    expect(log.filter((key) => key === originsCall)).toHaveLength(1)
    expect(asked).toHaveLength(1)
  })

  it('holds the pick until forget, then reads the origins and probes them again', async () => {
    const answers: Record<string, PingAnswer> = { [LAN.url]: {}, [TAILNET.url]: {} }
    const { access, log, asked } = run({ replies: withOrigins([LAN, TAILNET]), answers })
    const accessed = async () =>
      succeeded(await access.accessFor({ serverId: SERVER_ID, mediaId: 7 }))
    expect(await accessed()).toMatchObject({ kind: 'origin', url: LAN.url })
    answers[LAN.url] = { status: 503 }
    expect(await accessed()).toMatchObject({ kind: 'origin', url: LAN.url })
    access.forget(SERVER_ID)
    expect(await accessed()).toMatchObject({ kind: 'origin', url: TAILNET.url })
    expect(log.filter((key) => key === originsCall)).toHaveLength(2)
    expect(asked).toHaveLength(4)
  })

  it('answers locked when the ticket read answers the lock status', async () => {
    const { access } = run({
      replies: { ...withOrigins([LAN]), [ticketCall(7)]: { status: LOCKED_STATUS, body: '' } },
      answers: { [LAN.url]: {} },
    })
    const outcome = failed(await access.accessFor({ serverId: SERVER_ID, mediaId: 7 }))
    expect(outcome.reason).toBe('locked')
    expect(outcome.message).toBe(DOWNLOAD_MESSAGES.relocked('Vhagar'))
  })

  it('answers unreachable when the ticket read fails to connect', async () => {
    const { access } = run({
      replies: { ...withOrigins([LAN]), [ticketCall(7)]: { unreachable: 'Vhagar is asleep' } },
      answers: { [LAN.url]: {} },
    })
    const outcome = failed(await access.accessFor({ serverId: SERVER_ID, mediaId: 7 }))
    expect(outcome).toEqual({ ok: false, reason: 'unreachable', message: 'Vhagar is asleep' })
  })

  it('answers unreadable for a ticket body the guard refuses', async () => {
    const { access } = run({
      replies: { ...withOrigins([LAN]), [ticketCall(7)]: ok({ ticket: 4 }) },
      answers: { [LAN.url]: {} },
    })
    expect(failed(await access.accessFor({ serverId: SERVER_ID, mediaId: 7 })).reason).toBe(
      'unreadable',
    )
  })

  it('answers unreadable for a ticket read refused with another 4xx', async () => {
    const { access } = run({
      replies: { ...withOrigins([LAN]), [ticketCall(7)]: { status: 400, body: '' } },
      answers: { [LAN.url]: {} },
    })
    expect(failed(await access.accessFor({ serverId: SERVER_ID, mediaId: 7 })).reason).toBe(
      'unreadable',
    )
  })

  it.each([500, 502, 503, 504])(
    'answers unreachable for a ticket read the proxy answers %i',
    async (status) => {
      const { access } = run({
        replies: { ...withOrigins([LAN]), [ticketCall(7)]: { status, body: '' } },
        answers: { [LAN.url]: {} },
      })
      expect(failed(await access.accessFor({ serverId: SERVER_ID, mediaId: 7 }))).toEqual({
        ok: false,
        reason: 'unreachable',
        message: CALL_MESSAGES.unreachable('Vhagar'),
      })
    },
  )

  it('answers gone when the ticket read finds no such title', async () => {
    const { access } = run({
      replies: { ...withOrigins([LAN]), [ticketCall(7)]: { status: 404, body: '' } },
      answers: { [LAN.url]: {} },
    })
    expect(failed(await access.accessFor({ serverId: SERVER_ID, mediaId: 7 }))).toEqual({
      ok: false,
      reason: 'gone',
      message: EXPAND_MESSAGES.gone('Vhagar'),
    })
  })

  it("renews a ticket a fixed time after it was read, by raven player's clock, whatever its expiry says", async () => {
    expect(TICKET_RENEW_MS).toBe((MEDIA_TICKET_SECONDS - MEDIA_TICKET_REFRESH_SECONDS) * 1000)
    const renewAtFor = async (expiresAt: number) => {
      const { access } = run({
        replies: { ...withOrigins([LAN]), [ticketCall(7)]: ok({ ticket: 'tkt', expiresAt }) },
        answers: { [LAN.url]: {} },
        now: NOW,
      })
      return succeeded(await access.accessFor({ serverId: SERVER_ID, mediaId: 7 }))
    }
    const renewed: Access = {
      kind: 'origin',
      url: LAN.url,
      ticket: 'tkt',
      renewAt: NOW + TICKET_RENEW_MS,
    }
    expect(await renewAtFor(NOW + 6 * HOUR_MS)).toEqual(renewed)
    expect(await renewAtFor(NOW / 1000 + 6 * 3600)).toEqual(renewed)
    expect(await renewAtFor(NOW - HOUR_MS)).toEqual(renewed)
  })

  it('falls back to the cookie path, naming no URL, on a bad origins body', async () => {
    const { access, warnings, asked } = run({
      replies: {
        [originsCall]: ok({ origins: [{ kind: 'lan', url: 'http://secret.example:3000' }, 7] }),
      },
      answers: {},
    })
    const outcome = await access.accessFor({ serverId: SERVER_ID, mediaId: 7 })
    expect(succeeded(outcome)).toEqual({ kind: 'cookie' })
    expect(asked).toEqual([])
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain('Vhagar')
    expect(warnings.join(' ')).not.toContain('secret.example')
  })

  it('falls back to the cookie path, warning once, when the origins read fails', async () => {
    const { access, warnings } = run({
      replies: { [originsCall]: { unreachable: 'http://10.0.0.1 refused' } },
      answers: {},
    })
    const outcome = await access.accessFor({ serverId: SERVER_ID, mediaId: 7 })
    expect(succeeded(outcome)).toEqual({ kind: 'cookie' })
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).not.toContain('10.0.0.1')
  })

  it('names no ticket in the log', async () => {
    const { access, warnings } = run({
      replies: { ...withOrigins([LAN]), [ticketCall(7)]: ok({ ticket: 'tkt', expiresAt: 'soon' }) },
      answers: { [LAN.url]: {} },
    })
    await access.accessFor({ serverId: SERVER_ID, mediaId: 7 })
    expect(warnings.join(' ')).not.toContain('tkt')
  })

  it('drops origins that are not plain http or https, probing none of them', async () => {
    const hostile: MediaOrigin[] = [
      { kind: 'lan', url: 'file:///etc/hosts?' },
      { kind: 'tailnet', url: '/relative' },
      { kind: 'public', url: 'javascript:alert(1)' },
      { kind: 'lan', url: 'http://user:pass@192.168.1.9:3000' },
    ]
    const { access, warnings, asked } = run({ replies: withOrigins(hostile), answers: {} })
    const outcome = await access.accessFor({ serverId: SERVER_ID, mediaId: 7 })
    expect(succeeded(outcome)).toEqual({ kind: 'cookie' })
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
    const outcome = await access.accessFor({ serverId: SERVER_ID, mediaId: 7 })
    expect(succeeded(outcome)).toMatchObject({ kind: 'origin', url: LAN.url })
    expect(asked).toHaveLength(1)
  })

  it('cuts an origin with a path, query or trailing slash down to its origin', async () => {
    const { access, asked } = run({
      replies: withOrigins([{ kind: 'lan', url: `${LAN.url}/base/?x=1#h` }]),
      answers: { [LAN.url]: {} },
    })
    const outcome = await access.accessFor({ serverId: SERVER_ID, mediaId: 7 })
    expect(asked.map((entry) => entry.url)).toEqual([
      `${LAN.url}/api/media-origins/ping?bytes=${MEDIA_PROBE_BYTES}`,
    ])
    expect(succeeded(outcome)).toMatchObject({ kind: 'origin', url: LAN.url })
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
      warn: (message) => {
        warnings.push(message)
      },
    })
    expect(succeeded(await access.accessFor({ serverId: SERVER_ID, mediaId: 7 }))).toEqual({
      kind: 'cookie',
    })
    expect(succeeded(await access.accessFor({ serverId: SERVER_ID, mediaId: 7 }))).toEqual({
      kind: 'cookie',
    })
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).not.toContain('10.0.0.1')
  })

  it('answers unreachable for a server that is gone', async () => {
    const { access, log } = run({ replies: {}, answers: {}, server: null })
    const outcome = failed(await access.accessFor({ serverId: SERVER_ID, mediaId: 7 }))
    expect(outcome).toEqual({ ok: false, reason: 'unreachable', message: SERVER_GONE })
    expect(log).toEqual([])
  })
})

describe('fileUrlFor', () => {
  const origin = 'https://raven.example'

  it('puts the encoded ticket on an origin', () => {
    const access: Access = { kind: 'origin', url: LAN.url, ticket: 'a b/c+d=', renewAt: 1 }
    expect(fileUrlFor({ access, origin, mediaId: 7 })).toBe(
      `${LAN.url}/api/media/7/file?t=${encodeURIComponent('a b/c+d=')}`,
    )
  })

  it('builds the cookie path on the server origin with no ticket', () => {
    expect(fileUrlFor({ access: { kind: 'cookie' }, origin, mediaId: 7 })).toBe(
      `${origin}/api/media/7/file`,
    )
  })

  it('refuses a media id that is not one', () => {
    expect(() => fileUrlFor({ access: { kind: 'cookie' }, origin, mediaId: 0 })).toThrow(RangeError)
  })
})

describe('sidecarUrlFor', () => {
  const origin = 'https://raven.example'

  it('puts the encoded ticket on an origin', () => {
    const access: Access = { kind: 'origin', url: LAN.url, ticket: 'a b', renewAt: 1 }
    expect(sidecarUrlFor({ access, origin, mediaId: 7, trackId: 'external-3' })).toBe(
      `${LAN.url}/api/media/7/subtitles/external-3?t=a%20b`,
    )
  })

  it('builds the cookie path with no ticket', () => {
    expect(
      sidecarUrlFor({ access: { kind: 'cookie' }, origin, mediaId: 7, trackId: 'external-3' }),
    ).toBe(`${origin}/api/media/7/subtitles/external-3`)
  })

  it('refuses an embedded track and a bad media id', () => {
    const access: Access = { kind: 'cookie' }
    expect(() => sidecarUrlFor({ access, origin, mediaId: 7, trackId: 'embedded-0' })).toThrow(
      RangeError,
    )
    expect(() => sidecarUrlFor({ access, origin, mediaId: -1, trackId: 'external-0' })).toThrow(
      RangeError,
    )
  })
})
