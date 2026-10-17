import { describe, expect, it } from 'bun:test'
import { LOCKED_STATUS, MEDIA_PROBE_BYTES, type MediaOrigin } from '@raven/core'
import type { ServerEntry } from '@/main/desktopConfig'
import {
  createMediaAccess,
  fileUrlFor,
  ORIGIN_KIND_RANK,
  pickReachable,
  PROBE_TIMEOUT_MS,
  sidecarUrlFor,
  type Access,
  type AccessOutcome,
  type ProbeFetch,
} from '@/main/downloads/mediaAccess'
import { fakeCalls, keyOf, ok, type Reply } from '@/main/test/serverFakes'
import { SERVER_GONE } from '@/shared/protocol'

const SERVER_ID = '6f1c1c0e-3b0a-4f4e-8a55-0d2f3c5b7e11'
const SERVER: ServerEntry = {
  id: SERVER_ID,
  origin: 'https://raven.example',
  name: 'Vhagar',
  addedAt: 0,
}

const LAN: MediaOrigin = { kind: 'lan', url: 'http://192.168.1.5:3000' }
const LAN_TWO: MediaOrigin = { kind: 'lan', url: 'http://192.168.1.6:3000' }
const TAILNET: MediaOrigin = { kind: 'tailnet', url: 'http://vhagar.tail.ts.net:3000' }
const PUBLIC: MediaOrigin = { kind: 'public', url: 'https://media.example.com' }

const originsCall = keyOf({ name: 'getMediaOrigins' })
const ticketCall = (mediaId: number): string => keyOf({ name: 'getMediaTicket', mediaId })

const probed = ({
  origin,
  status = 200,
  firstByteMs = 10,
}: {
  origin: MediaOrigin
  status?: number
  firstByteMs?: number
}) => ({ origin, status, firstByteMs })

const succeeded = (outcome: AccessOutcome): Access => {
  if (!outcome.ok) throw new Error(`expected ok, got ${outcome.reason}`)
  return outcome.access
}

const failed = (outcome: AccessOutcome) => {
  if (outcome.ok) throw new Error('expected a refusal')
  return outcome
}

/** A probe that answers from `answers` by URL prefix, and records every URL it was asked. */
const answeringProbe = (
  answers: Record<string, { status: number; firstByteMs: number } | 'fail'>,
) => {
  const asked: { url: string; timeoutMs: number }[] = []
  const probe: ProbeFetch = async ({ url, timeoutMs }) => {
    asked.push({ url, timeoutMs })
    const key = Object.keys(answers).find((prefix) => url.startsWith(prefix))
    const answer = key === undefined ? 'fail' : (answers[key] ?? 'fail')
    if (answer === 'fail') throw new Error('timed out')
    return answer
  }
  return { probe, asked }
}

const run = ({
  replies,
  probe,
  server = SERVER,
}: {
  replies: Record<string, Reply>
  probe: ProbeFetch
  server?: ServerEntry | null
}) => {
  const { calls, log } = fakeCalls(replies)
  const warnings: string[] = []
  const access = createMediaAccess({
    calls,
    serverOf: (serverId) => (server !== null && serverId === server.id ? server : null),
    probe,
    now: () => 0,
    warn: (message) => {
      warnings.push(message)
    },
  })
  return { access, log, warnings }
}

const withOrigins = (origins: MediaOrigin[]): Record<string, Reply> => ({
  [originsCall]: ok({ origins }),
  [ticketCall(7)]: ok({ ticket: 'tkt', expiresAt: 1_000 }),
})

describe('pickReachable', () => {
  it('prefers lan over a faster public', () => {
    const pick = pickReachable([
      probed({ origin: PUBLIC, firstByteMs: 1 }),
      probed({ origin: LAN, firstByteMs: 80 }),
    ])
    expect(pick).toEqual(LAN)
  })

  it('prefers the faster first byte among two of a kind', () => {
    const pick = pickReachable([
      probed({ origin: LAN, firstByteMs: 40 }),
      probed({ origin: LAN_TWO, firstByteMs: 9 }),
    ])
    expect(pick).toEqual(LAN_TWO)
  })

  it('skips an origin that answered 500 or timed out', () => {
    const pick = pickReachable([
      probed({ origin: LAN, status: 500 }),
      probed({ origin: TAILNET, status: 0 }),
      probed({ origin: PUBLIC }),
    ])
    expect(pick).toEqual(PUBLIC)
  })

  it('picks null when none answered', () => {
    expect(pickReachable([probed({ origin: LAN, status: 500 })])).toBeNull()
    expect(pickReachable([])).toBeNull()
  })

  it('ranks lan before tailnet before public', () => {
    expect(ORIGIN_KIND_RANK).toEqual({ lan: 0, tailnet: 1, public: 2 })
  })
})

describe('createMediaAccess', () => {
  it('answers the cookie path, without probing, when no origin is listed', async () => {
    const { probe, asked } = answeringProbe({})
    const { access, log } = run({ replies: withOrigins([]), probe })
    const outcome = await access.accessFor({ serverId: SERVER_ID, mediaId: 7 })
    expect(succeeded(outcome)).toEqual({ kind: 'cookie' })
    expect(asked).toEqual([])
    expect(log).toEqual([originsCall])
  })

  it('starts both probes before either answers, then picks the lan one', async () => {
    const started: string[] = []
    const releases: (() => void)[] = []
    const probe: ProbeFetch = ({ url }) =>
      new Promise((resolve) => {
        started.push(url)
        releases.push(() =>
          resolve({ status: 200, firstByteMs: url.startsWith(PUBLIC.url) ? 1 : 50 }),
        )
      })
    const { access } = run({ replies: withOrigins([PUBLIC, LAN]), probe })
    const pending = access.accessFor({ serverId: SERVER_ID, mediaId: 7 })
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(started).toEqual([
      `${PUBLIC.url}/api/media-origins/ping?bytes=${MEDIA_PROBE_BYTES}`,
      `${LAN.url}/api/media-origins/ping?bytes=${MEDIA_PROBE_BYTES}`,
    ])
    releases.forEach((release) => release())
    expect(succeeded(await pending)).toEqual({
      kind: 'origin',
      url: LAN.url,
      ticket: 'tkt',
      expiresAt: 1_000_000,
    })
  })

  it('hands the brief timeout to each probe', async () => {
    const { probe, asked } = answeringProbe({ [LAN.url]: { status: 200, firstByteMs: 3 } })
    const { access } = run({ replies: withOrigins([LAN]), probe })
    await access.accessFor({ serverId: SERVER_ID, mediaId: 7 })
    expect(PROBE_TIMEOUT_MS).toBe(2000)
    expect(asked.map((entry) => entry.timeoutMs)).toEqual([PROBE_TIMEOUT_MS])
  })

  it('counts a rejected probe as not answering and falls back to the cookie path', async () => {
    const { probe } = answeringProbe({})
    const { access, log } = run({ replies: withOrigins([LAN, PUBLIC]), probe })
    const outcome = await access.accessFor({ serverId: SERVER_ID, mediaId: 7 })
    expect(succeeded(outcome)).toEqual({ kind: 'cookie' })
    expect(log).toEqual([originsCall])
  })

  it('skips the origin that failed and uses the one that answered', async () => {
    const { probe } = answeringProbe({ [PUBLIC.url]: { status: 200, firstByteMs: 20 } })
    const { access } = run({ replies: withOrigins([LAN, PUBLIC]), probe })
    const outcome = await access.accessFor({ serverId: SERVER_ID, mediaId: 7 })
    expect(succeeded(outcome)).toMatchObject({ kind: 'origin', url: PUBLIC.url })
  })

  it('reads a fresh ticket on every call', async () => {
    const { probe } = answeringProbe({ [LAN.url]: { status: 200, firstByteMs: 3 } })
    const { access, log } = run({ replies: withOrigins([LAN]), probe })
    await access.accessFor({ serverId: SERVER_ID, mediaId: 7 })
    await access.accessFor({ serverId: SERVER_ID, mediaId: 7 })
    expect(log.filter((key) => key === ticketCall(7))).toHaveLength(2)
  })

  it('reads the origins once per server across two files, and probes once', async () => {
    const { probe, asked } = answeringProbe({ [LAN.url]: { status: 200, firstByteMs: 3 } })
    const { access, log } = run({
      replies: { ...withOrigins([LAN]), [ticketCall(8)]: ok({ ticket: 'two', expiresAt: 5 }) },
      probe,
    })
    await Promise.all([
      access.accessFor({ serverId: SERVER_ID, mediaId: 7 }),
      access.accessFor({ serverId: SERVER_ID, mediaId: 8 }),
    ])
    await access.accessFor({ serverId: SERVER_ID, mediaId: 7 })
    expect(log.filter((key) => key === originsCall)).toHaveLength(1)
    expect(asked).toHaveLength(1)
  })

  it('reads the origins again after forget', async () => {
    const { probe } = answeringProbe({ [LAN.url]: { status: 200, firstByteMs: 3 } })
    const { access, log } = run({ replies: withOrigins([LAN]), probe })
    await access.accessFor({ serverId: SERVER_ID, mediaId: 7 })
    access.forget(SERVER_ID)
    await access.accessFor({ serverId: SERVER_ID, mediaId: 7 })
    expect(log.filter((key) => key === originsCall)).toHaveLength(2)
  })

  it('answers locked when the ticket read answers the lock status', async () => {
    const { probe } = answeringProbe({ [LAN.url]: { status: 200, firstByteMs: 3 } })
    const { access } = run({
      replies: { ...withOrigins([LAN]), [ticketCall(7)]: { status: LOCKED_STATUS, body: '' } },
      probe,
    })
    const outcome = failed(await access.accessFor({ serverId: SERVER_ID, mediaId: 7 }))
    expect(outcome.reason).toBe('locked')
    expect(outcome.message).toBe('Vhagar locked this library again')
  })

  it('answers unreachable when the ticket read fails to connect', async () => {
    const { probe } = answeringProbe({ [LAN.url]: { status: 200, firstByteMs: 3 } })
    const { access } = run({
      replies: { ...withOrigins([LAN]), [ticketCall(7)]: { unreachable: 'Vhagar is asleep' } },
      probe,
    })
    const outcome = failed(await access.accessFor({ serverId: SERVER_ID, mediaId: 7 }))
    expect(outcome).toEqual({ ok: false, reason: 'unreachable', message: 'Vhagar is asleep' })
  })

  it('answers unreadable for a ticket body the guard refuses', async () => {
    const { probe } = answeringProbe({ [LAN.url]: { status: 200, firstByteMs: 3 } })
    const { access } = run({
      replies: { ...withOrigins([LAN]), [ticketCall(7)]: ok({ ticket: 4 }) },
      probe,
    })
    expect(failed(await access.accessFor({ serverId: SERVER_ID, mediaId: 7 })).reason).toBe(
      'unreadable',
    )
  })

  it('answers unreadable for a ticket read that is not a 200', async () => {
    const { probe } = answeringProbe({ [LAN.url]: { status: 200, firstByteMs: 3 } })
    const { access } = run({
      replies: { ...withOrigins([LAN]), [ticketCall(7)]: { status: 500, body: '' } },
      probe,
    })
    expect(failed(await access.accessFor({ serverId: SERVER_ID, mediaId: 7 })).reason).toBe(
      'unreadable',
    )
  })

  it('falls back to the cookie path, naming no URL, on a bad origins body', async () => {
    const { probe, asked } = answeringProbe({})
    const { access, warnings } = run({
      replies: {
        [originsCall]: ok({ origins: [{ kind: 'lan', url: 'http://secret.example:3000' }, 7] }),
      },
      probe,
    })
    const outcome = await access.accessFor({ serverId: SERVER_ID, mediaId: 7 })
    expect(succeeded(outcome)).toEqual({ kind: 'cookie' })
    expect(asked).toEqual([])
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain('Vhagar')
    expect(warnings.join(' ')).not.toContain('secret.example')
  })

  it('falls back to the cookie path, warning once, when the origins read fails', async () => {
    const { probe } = answeringProbe({})
    const { access, warnings } = run({
      replies: { [originsCall]: { unreachable: 'http://10.0.0.1 refused' } },
      probe,
    })
    const outcome = await access.accessFor({ serverId: SERVER_ID, mediaId: 7 })
    expect(succeeded(outcome)).toEqual({ kind: 'cookie' })
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).not.toContain('10.0.0.1')
  })

  it('names no ticket in the log', async () => {
    const { probe } = answeringProbe({ [LAN.url]: { status: 200, firstByteMs: 3 } })
    const { access, warnings } = run({
      replies: { ...withOrigins([LAN]), [ticketCall(7)]: ok({ ticket: 'tkt', expiresAt: 'soon' }) },
      probe,
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
    const { probe, asked } = answeringProbe({})
    const { access, warnings } = run({ replies: withOrigins(hostile), probe })
    const outcome = await access.accessFor({ serverId: SERVER_ID, mediaId: 7 })
    expect(succeeded(outcome)).toEqual({ kind: 'cookie' })
    expect(asked).toEqual([])
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain('Vhagar')
    expect(warnings[0]).toContain('lan, tailnet, public, lan')
    expect(warnings.join(' ')).not.toMatch(/etc|relative|javascript|pass/u)
  })

  it('keeps a trusted origin beside a dropped one', async () => {
    const { probe, asked } = answeringProbe({ [LAN.url]: { status: 200, firstByteMs: 3 } })
    const { access } = run({
      replies: withOrigins([{ kind: 'lan', url: 'file:///etc/hosts?' }, LAN]),
      probe,
    })
    const outcome = await access.accessFor({ serverId: SERVER_ID, mediaId: 7 })
    expect(succeeded(outcome)).toMatchObject({ kind: 'origin', url: LAN.url })
    expect(asked).toHaveLength(1)
  })

  it('cuts an origin with a path, query or trailing slash down to its origin', async () => {
    const { probe, asked } = answeringProbe({ [LAN.url]: { status: 200, firstByteMs: 3 } })
    const { access } = run({
      replies: withOrigins([{ kind: 'lan', url: `${LAN.url}/base/?x=1#h` }]),
      probe,
    })
    const outcome = await access.accessFor({ serverId: SERVER_ID, mediaId: 7 })
    expect(asked.map((entry) => entry.url)).toEqual([
      `${LAN.url}/api/media-origins/ping?bytes=${MEDIA_PROBE_BYTES}`,
    ])
    expect(succeeded(outcome)).toMatchObject({ kind: 'origin', url: LAN.url })
  })

  it('treats an origins call that rejects as a failed read, and does not hold the rejection', async () => {
    const { probe } = answeringProbe({})
    const warnings: string[] = []
    const access = createMediaAccess({
      calls: {
        call: async () => {
          throw new Error('boom http://10.0.0.1')
        },
      },
      serverOf: () => SERVER,
      probe,
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
    const { probe } = answeringProbe({})
    const { access, log } = run({ replies: {}, probe, server: null })
    const outcome = failed(await access.accessFor({ serverId: SERVER_ID, mediaId: 7 }))
    expect(outcome).toEqual({ ok: false, reason: 'unreachable', message: SERVER_GONE })
    expect(log).toEqual([])
  })
})

describe('fileUrlFor', () => {
  const origin = 'https://raven.example'

  it('puts the encoded ticket on an origin', () => {
    const access: Access = { kind: 'origin', url: LAN.url, ticket: 'a b/c+d=', expiresAt: 1 }
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
    const access: Access = { kind: 'origin', url: LAN.url, ticket: 'a b', expiresAt: 1 }
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
