import {
  MEDIA_PROBE_BYTES,
  MEDIA_PROBE_TIMEOUT_MS,
  type MediaOrigin,
  PICK_FRESH_MS,
} from '@raven/core'
import { describe, expect, it } from 'bun:test'
import type { ServerEntry } from '@/main/desktopConfig'
import { CALL_NAMES } from '@/main/servers/allowlist'
import { createOriginPicks } from '@/main/servers/originPicks'
import { pingNetwork, type PingAnswer } from '@/main/test/pingNetwork'
import { fakeCalls, keyOf, ok, type Reply } from '@/main/test/serverFakes'

const SERVER: ServerEntry = {
  id: '6f1c1c0e-3b0a-4f4e-8a55-0d2f3c5b7e11',
  origin: 'https://raven.example',
  name: 'Vhagar',
}

const MB = 1_000_000

const LAN: MediaOrigin = { kind: 'lan', url: 'http://192.168.1.5:3000' }
const LAN_TWO: MediaOrigin = { kind: 'lan', url: 'http://192.168.1.6:3000' }
const TAILNET: MediaOrigin = { kind: 'tailnet', url: 'http://vhagar.tail.ts.net:3000' }
const PUBLIC: MediaOrigin = { kind: 'public', url: 'https://media.example.com' }

const originsCall = keyOf({ name: CALL_NAMES.getMediaOrigins })
const pingOf = (origin: MediaOrigin): string =>
  `${origin.url}/api/media-origins/ping?bytes=${MEDIA_PROBE_BYTES}`

type RunProps = {
  replies: Record<string, Reply>
  answers: Record<string, PingAnswer>
}

const run = ({ replies, answers }: RunProps) => {
  const { calls, log } = fakeCalls(replies)
  const network = pingNetwork(answers)
  const warnings: string[] = []
  const clock = { now: 0 }
  const picks = createOriginPicks({
    calls,
    probe: network.probe,
    probeClock: network.clock,
    now: () => clock.now,
    warn: (message) => {
      warnings.push(message)
    },
  })
  return { picks, log, warnings, asked: network.asked, clock }
}

const withOrigins = (origins: MediaOrigin[]): Record<string, Reply> => ({
  [originsCall]: ok({ origins }),
})

type PickedFromProps = {
  origins: MediaOrigin[]
  answers: Record<string, PingAnswer>
}

const pickedFrom = ({ origins, answers }: PickedFromProps): Promise<string> =>
  run({ replies: withOrigins(origins), answers }).picks.originOf(SERVER)

describe('the pick', () => {
  it('takes a tailnet origin over a lan one far slower than it', async () => {
    const picked = await pickedFrom({
      origins: [LAN, TAILNET],
      answers: {
        [LAN.url]: { firstByteMs: 5, bytesPerSecond: 1 * MB },
        [TAILNET.url]: { firstByteMs: 5, bytesPerSecond: 20 * MB },
      },
    })
    expect(picked).toBe(TAILNET.url)
  })

  it('takes a fast lan origin over the slow public address', async () => {
    const picked = await pickedFrom({
      origins: [LAN, PUBLIC],
      answers: {
        [LAN.url]: { firstByteMs: 3, bytesPerSecond: 10.8 * MB },
        [PUBLIC.url]: { firstByteMs: 60, bytesPerSecond: 0.58 * MB },
      },
    })
    expect(picked).toBe(LAN.url)
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
    expect(picked).toBe(LAN.url)
  })

  it('counts a slow first byte against an origin', async () => {
    const picked = await pickedFrom({
      origins: [LAN, PUBLIC],
      answers: {
        [LAN.url]: { firstByteMs: 400, bytesPerSecond: 10 * MB },
        [PUBLIC.url]: { firstByteMs: 5, bytesPerSecond: 10 * MB },
      },
    })
    expect(picked).toBe(PUBLIC.url)
  })

  it('takes the quicker first byte between two of a kind inside the band', async () => {
    const picked = await pickedFrom({
      origins: [LAN, LAN_TWO],
      answers: {
        [LAN.url]: { firstByteMs: 12, bytesPerSecond: 10 * MB },
        [LAN_TWO.url]: { firstByteMs: 6, bytesPerSecond: 10 * MB },
      },
    })
    expect(picked).toBe(LAN_TWO.url)
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
    expect(picked).toBe(PUBLIC.url)
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
    expect(picked).toBe(SERVER.origin)
  })
})

describe('createOriginPicks', () => {
  it("uses the server's own origin, without probing, when no origin is listed, and holds that", async () => {
    const { picks, log, asked } = run({ replies: withOrigins([]), answers: {} })
    expect(await picks.originOf(SERVER)).toBe(SERVER.origin)
    expect(await picks.originOf(SERVER)).toBe(SERVER.origin)
    expect(asked).toEqual([])
    expect(log).toEqual([originsCall])
  })

  it('starts every probe before any answers, each with the brief timeout', async () => {
    const { picks, asked } = run({
      replies: withOrigins([PUBLIC, LAN]),
      answers: { [PUBLIC.url]: { firstByteMs: 10 }, [LAN.url]: { firstByteMs: 12 } },
    })
    expect(await picks.originOf(SERVER)).toBe(LAN.url)
    expect(asked).toEqual([
      { url: pingOf(PUBLIC), timeoutMs: MEDIA_PROBE_TIMEOUT_MS, at: 0 },
      { url: pingOf(LAN), timeoutMs: MEDIA_PROBE_TIMEOUT_MS, at: 0 },
    ])
  })

  it('reads the origins once for asks that come together, and probes once', async () => {
    const { picks, log, asked } = run({ replies: withOrigins([LAN]), answers: { [LAN.url]: {} } })
    await Promise.all([picks.originOf(SERVER), picks.originOf(SERVER)])
    await picks.originOf(SERVER)
    expect(log.filter((key) => key === originsCall)).toHaveLength(1)
    expect(asked).toHaveLength(1)
  })

  it('holds the pick until forget, then reads the origins and probes them again', async () => {
    const answers: Record<string, PingAnswer> = { [LAN.url]: {}, [TAILNET.url]: {} }
    const { picks, log, asked } = run({ replies: withOrigins([LAN, TAILNET]), answers })
    expect(await picks.originOf(SERVER)).toBe(LAN.url)
    answers[LAN.url] = { status: 503 }
    expect(await picks.originOf(SERVER)).toBe(LAN.url)
    picks.forget(SERVER.id)
    expect(await picks.originOf(SERVER)).toBe(TAILNET.url)
    expect(log.filter((key) => key === originsCall)).toHaveLength(2)
    expect(asked).toHaveLength(4)
  })

  it('holds the pick for PICK_FRESH_MS, then probes again', async () => {
    const answers: Record<string, PingAnswer> = { [LAN.url]: {}, [PUBLIC.url]: {} }
    const { picks, asked, clock } = run({ replies: withOrigins([LAN, PUBLIC]), answers })
    expect(await picks.originOf(SERVER)).toBe(LAN.url)
    answers[LAN.url] = { status: 503 }
    clock.now = PICK_FRESH_MS - 1
    expect(await picks.originOf(SERVER)).toBe(LAN.url)
    expect(asked).toHaveLength(2)
    clock.now = PICK_FRESH_MS
    expect(await picks.originOf(SERVER)).toBe(PUBLIC.url)
    expect(asked).toHaveLength(4)
  })

  it('probes again on a pick dated ahead of a clock set back', async () => {
    const { picks, asked, clock } = run({
      replies: withOrigins([LAN]),
      answers: { [LAN.url]: {} },
    })
    clock.now = 10_000
    await picks.originOf(SERVER)
    clock.now = 0
    await picks.originOf(SERVER)
    expect(asked).toHaveLength(2)
  })

  it("falls back to the server's own origin while a listed lan origin is unreachable, and takes it once it answers", async () => {
    const answers: Record<string, PingAnswer> = {}
    const { picks, log } = run({ replies: withOrigins([LAN]), answers })
    expect(await picks.originOf(SERVER)).toBe(SERVER.origin)
    answers[LAN.url] = {}
    expect(await picks.originOf(SERVER)).toBe(LAN.url)
    expect(log.filter((key) => key === originsCall)).toHaveLength(2)
  })

  it('lets go of the pick of one server alone', async () => {
    const other: ServerEntry = { ...SERVER, id: '7c9e6679-7425-40de-944b-e07fc1f90ae7' }
    const { picks, log } = run({ replies: withOrigins([LAN]), answers: { [LAN.url]: {} } })
    await picks.originOf(SERVER)
    await picks.originOf(other)
    picks.forget(other.id)
    await picks.originOf(SERVER)
    await picks.originOf(other)
    expect(log.filter((key) => key === originsCall)).toHaveLength(3)
  })

  it('uses the server origin, naming no URL in the log, on a bad origins body', async () => {
    const { picks, warnings, asked } = run({
      replies: {
        [originsCall]: ok({ origins: [{ kind: 'lan', url: 'http://secret.example:3000' }, 7] }),
      },
      answers: {},
    })
    expect(await picks.originOf(SERVER)).toBe(SERVER.origin)
    expect(asked).toEqual([])
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain('Vhagar')
    expect(warnings.join(' ')).not.toContain('secret.example')
  })

  it('uses the server origin, warning once, when the origins read fails', async () => {
    const { picks, warnings } = run({
      replies: { [originsCall]: { unreachable: 'http://10.0.0.1 refused' } },
      answers: {},
    })
    expect(await picks.originOf(SERVER)).toBe(SERVER.origin)
    expect(await picks.originOf(SERVER)).toBe(SERVER.origin)
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
    const { picks, warnings, asked } = run({ replies: withOrigins(hostile), answers: {} })
    expect(await picks.originOf(SERVER)).toBe(SERVER.origin)
    expect(asked).toEqual([])
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain('Vhagar')
    expect(warnings[0]).toContain('lan, tailnet, public, lan')
    expect(warnings.join(' ')).not.toMatch(/etc|relative|javascript|pass/u)
  })

  it('keeps a trusted origin beside a dropped one', async () => {
    const { picks, asked } = run({
      replies: withOrigins([{ kind: 'lan', url: 'file:///etc/hosts?' }, LAN]),
      answers: { [LAN.url]: {} },
    })
    expect(await picks.originOf(SERVER)).toBe(LAN.url)
    expect(asked).toHaveLength(1)
  })

  it('cuts an origin with a path, query or trailing slash down to its origin', async () => {
    const { picks, asked } = run({
      replies: withOrigins([{ kind: 'lan', url: `${LAN.url}/base/?x=1#h` }]),
      answers: { [LAN.url]: {} },
    })
    expect(await picks.originOf(SERVER)).toBe(LAN.url)
    expect(asked.map((entry) => entry.url)).toEqual([pingOf(LAN)])
  })

  it('treats an origins call that rejects as a failed read, and does not hold the rejection', async () => {
    const network = pingNetwork({})
    const warnings: string[] = []
    const picks = createOriginPicks({
      calls: {
        call: async () => {
          throw new Error('boom http://10.0.0.1')
        },
      },
      probe: network.probe,
      probeClock: network.clock,
      now: () => 0,
      warn: (message) => {
        warnings.push(message)
      },
    })
    expect(await picks.originOf(SERVER)).toBe(SERVER.origin)
    expect(await picks.originOf(SERVER)).toBe(SERVER.origin)
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).not.toContain('10.0.0.1')
  })

  it('a warn that throws never fails a pick', async () => {
    const picks = createOriginPicks({
      calls: fakeCalls({}).calls,
      probe: pingNetwork({}).probe,
      probeClock: () => 0,
      now: () => 0,
      warn: () => {
        throw new Error('the log is closed')
      },
    })
    expect(await picks.originOf(SERVER)).toBe(SERVER.origin)
  })
})
