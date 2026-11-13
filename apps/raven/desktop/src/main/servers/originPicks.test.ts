import {
  MEDIA_PROBE_BYTES,
  MEDIA_PROBE_TIMEOUT_MS,
  type MediaOrigin,
  PICK_FRESH_MS,
} from '@raven/core'
import { describe, expect, it } from 'bun:test'
import { SERVER_NAME, type ServerEntry } from '@/main/desktopConfig'
import { CALL_NAMES } from '@/main/servers/allowlist'
import { createOriginPicks } from '@/main/servers/originPicks'
import { pingNetwork, type PingAnswer } from '@/main/test/pingNetwork'
import { fakeCalls, keyOf, ok, type Reply } from '@/main/test/serverFakes'

const SERVER: ServerEntry = {
  id: '6f1c1c0e-3b0a-4f4e-8a55-0d2f3c5b7e11',
  origin: 'https://raven.example',
}

const MB = 1_000_000

const LAN: MediaOrigin = { kind: 'lan', url: 'http://192.168.1.5:3000' }
const LAN_TWO: MediaOrigin = { kind: 'lan', url: 'http://192.168.1.6:3000' }
const AWAY: MediaOrigin = { kind: 'public', url: 'https://raven.example.synology.me:8443' }
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
    server: SERVER,
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
  run({ replies: withOrigins(origins), answers }).picks.originOf()

describe('the pick', () => {
  it('takes a public origin over a lan one far slower than it', async () => {
    const picked = await pickedFrom({
      origins: [LAN, AWAY],
      answers: {
        [LAN.url]: { firstByteMs: 5, bytesPerSecond: 1 * MB },
        [AWAY.url]: { firstByteMs: 5, bytesPerSecond: 20 * MB },
      },
    })
    expect(picked).toBe(AWAY.url)
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
      origins: [PUBLIC, AWAY, LAN],
      answers: {
        [PUBLIC.url]: { firstByteMs: 5, bytesPerSecond: 10 * MB },
        [AWAY.url]: { firstByteMs: 5, bytesPerSecond: 10 * MB },
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
      origins: [LAN, LAN_TWO, AWAY, { kind: 'lan', url: 'http://10.1.1.1:3000' }, PUBLIC],
      answers: {
        [LAN_TWO.url]: { status: 503 },
        [AWAY.url]: { isBroken: true },
        'http://10.1.1.1:3000': { bytes: MEDIA_PROBE_BYTES - 1 },
        [PUBLIC.url]: { firstByteMs: 80, bytesPerSecond: 2 * MB },
      },
    })
    expect(picked).toBe(PUBLIC.url)
  })

  it("uses the server's own origin when no probe scores", async () => {
    const picked = await pickedFrom({
      origins: [LAN, LAN_TWO, AWAY, PUBLIC],
      answers: {
        [LAN_TWO.url]: { status: 500 },
        [AWAY.url]: { isBroken: true },
        [PUBLIC.url]: { bytes: 0 },
      },
    })
    expect(picked).toBe(SERVER.origin)
  })
})

describe('createOriginPicks', () => {
  it("uses the server's own origin, without probing, when no origin is listed, and holds that", async () => {
    const { picks, log, asked } = run({ replies: withOrigins([]), answers: {} })
    expect(await picks.originOf()).toBe(SERVER.origin)
    expect(await picks.originOf()).toBe(SERVER.origin)
    expect(asked).toEqual([])
    expect(log).toEqual([originsCall])
  })

  it('starts every probe before any answers, each with the brief timeout', async () => {
    const { picks, asked } = run({
      replies: withOrigins([PUBLIC, LAN]),
      answers: { [PUBLIC.url]: { firstByteMs: 10 }, [LAN.url]: { firstByteMs: 12 } },
    })
    expect(await picks.originOf()).toBe(LAN.url)
    expect(asked).toEqual([
      { url: pingOf(PUBLIC), timeoutMs: MEDIA_PROBE_TIMEOUT_MS, at: 0 },
      { url: pingOf(LAN), timeoutMs: MEDIA_PROBE_TIMEOUT_MS, at: 0 },
    ])
  })

  it('reads the origins once for asks that come together, and probes once', async () => {
    const { picks, log, asked } = run({ replies: withOrigins([LAN]), answers: { [LAN.url]: {} } })
    await Promise.all([picks.originOf(), picks.originOf()])
    await picks.originOf()
    expect(log.filter((key) => key === originsCall)).toHaveLength(1)
    expect(asked).toHaveLength(1)
  })

  it('holds the pick until forget, then reads the origins and probes them again', async () => {
    const answers: Record<string, PingAnswer> = { [LAN.url]: {}, [AWAY.url]: {} }
    const { picks, log, asked } = run({ replies: withOrigins([LAN, AWAY]), answers })
    expect(await picks.originOf()).toBe(LAN.url)
    answers[LAN.url] = { status: 503 }
    expect(await picks.originOf()).toBe(LAN.url)
    picks.forget()
    expect(await picks.originOf()).toBe(AWAY.url)
    expect(log.filter((key) => key === originsCall)).toHaveLength(2)
    expect(asked).toHaveLength(4)
  })

  it('holds the pick for PICK_FRESH_MS, then probes again', async () => {
    const answers: Record<string, PingAnswer> = { [LAN.url]: {}, [PUBLIC.url]: {} }
    const { picks, asked, clock } = run({ replies: withOrigins([LAN, PUBLIC]), answers })
    expect(await picks.originOf()).toBe(LAN.url)
    answers[LAN.url] = { status: 503 }
    clock.now = PICK_FRESH_MS - 1
    expect(await picks.originOf()).toBe(LAN.url)
    expect(asked).toHaveLength(2)
    clock.now = PICK_FRESH_MS
    expect(await picks.originOf()).toBe(PUBLIC.url)
    expect(asked).toHaveLength(4)
  })

  it('probes again on a pick dated ahead of a clock set back', async () => {
    const { picks, asked, clock } = run({
      replies: withOrigins([LAN]),
      answers: { [LAN.url]: {} },
    })
    clock.now = 10_000
    await picks.originOf()
    clock.now = 0
    await picks.originOf()
    expect(asked).toHaveLength(2)
  })

  it("falls back to the server's own origin while a listed lan origin is unreachable, and takes it once it answers", async () => {
    const answers: Record<string, PingAnswer> = {}
    const { picks, log } = run({ replies: withOrigins([LAN]), answers })
    expect(await picks.originOf()).toBe(SERVER.origin)
    answers[LAN.url] = {}
    expect(await picks.originOf()).toBe(LAN.url)
    expect(log.filter((key) => key === originsCall)).toHaveLength(2)
  })

  it('uses the server origin, naming no URL in the log, on a bad origins body', async () => {
    const { picks, warnings, asked } = run({
      replies: {
        [originsCall]: ok({ origins: [{ kind: 'lan', url: 'http://secret.example:3000' }, 7] }),
      },
      answers: {},
    })
    expect(await picks.originOf()).toBe(SERVER.origin)
    expect(asked).toEqual([])
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain(SERVER_NAME)
    expect(warnings.join(' ')).not.toContain('secret.example')
  })

  it('uses the server origin, warning once, when the origins read fails', async () => {
    const { picks, warnings } = run({
      replies: { [originsCall]: { unreachable: 'http://10.0.0.1 refused' } },
      answers: {},
    })
    expect(await picks.originOf()).toBe(SERVER.origin)
    expect(await picks.originOf()).toBe(SERVER.origin)
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).not.toContain('10.0.0.1')
  })

  it('drops origins that are not plain http or https, probing none of them', async () => {
    const hostile: MediaOrigin[] = [
      { kind: 'lan', url: 'file:///etc/hosts?' },
      { kind: 'public', url: '/relative' },
      { kind: 'public', url: 'javascript:alert(1)' },
      { kind: 'lan', url: 'http://user:pass@192.168.1.9:3000' },
    ]
    const { picks, warnings, asked } = run({ replies: withOrigins(hostile), answers: {} })
    expect(await picks.originOf()).toBe(SERVER.origin)
    expect(asked).toEqual([])
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain(SERVER_NAME)
    expect(warnings[0]).toContain('lan, public, public, lan')
    expect(warnings.join(' ')).not.toMatch(/etc|relative|javascript|pass/u)
  })

  it('keeps a trusted origin beside a dropped one', async () => {
    const { picks, asked } = run({
      replies: withOrigins([{ kind: 'lan', url: 'file:///etc/hosts?' }, LAN]),
      answers: { [LAN.url]: {} },
    })
    expect(await picks.originOf()).toBe(LAN.url)
    expect(asked).toHaveLength(1)
  })

  it('cuts an origin with a path, query or trailing slash down to its origin', async () => {
    const { picks, asked } = run({
      replies: withOrigins([{ kind: 'lan', url: `${LAN.url}/base/?x=1#h` }]),
      answers: { [LAN.url]: {} },
    })
    expect(await picks.originOf()).toBe(LAN.url)
    expect(asked.map((entry) => entry.url)).toEqual([pingOf(LAN)])
  })

  it('treats an origins call that rejects as a failed read, and does not hold the rejection', async () => {
    const network = pingNetwork({})
    const warnings: string[] = []
    const picks = createOriginPicks({
      server: SERVER,
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
    expect(await picks.originOf()).toBe(SERVER.origin)
    expect(await picks.originOf()).toBe(SERVER.origin)
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).not.toContain('10.0.0.1')
  })

  it('a warn that throws never fails a pick', async () => {
    const picks = createOriginPicks({
      server: SERVER,
      calls: fakeCalls({}).calls,
      probe: pingNetwork({}).probe,
      probeClock: () => 0,
      now: () => 0,
      warn: () => {
        throw new Error('the log is closed')
      },
    })
    expect(await picks.originOf()).toBe(SERVER.origin)
  })
})

describe('placeOf', () => {
  const REMOTE = { limit: 'high720', isOutside: true } as const

  it('answers the origin picked and what the server said of remote play, from the one probe', async () => {
    const { picks, log } = run({
      replies: { [originsCall]: ok({ origins: [AWAY], remote: REMOTE }) },
      answers: { [AWAY.url]: { firstByteMs: 5 } },
    })
    expect(await picks.placeOf()).toEqual({ url: AWAY.url, origin: AWAY, remote: REMOTE })
    expect(await picks.originOf()).toBe(AWAY.url)
    expect(log).toEqual([originsCall])
  })

  it("answers the server's own address, and the server's word, when no origin answers", async () => {
    const { picks } = run({
      replies: { [originsCall]: ok({ origins: [], remote: REMOTE }) },
      answers: {},
    })
    expect(await picks.placeOf()).toEqual({
      url: SERVER.origin,
      origin: null,
      remote: REMOTE,
    })
  })

  it('says nothing of remote play for an older server, or one whose list cannot be read', async () => {
    const older = run({ replies: withOrigins([]), answers: {} })
    expect((await older.picks.placeOf()).remote).toBeNull()
    const unreadable = run({ replies: { [originsCall]: ok({ nope: true }) }, answers: {} })
    expect(await unreadable.picks.placeOf()).toEqual({
      url: SERVER.origin,
      origin: null,
      remote: null,
    })
  })
})
