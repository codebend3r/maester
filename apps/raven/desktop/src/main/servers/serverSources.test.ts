import { afterEach, describe, expect, jest, test } from 'bun:test'
import type { MediaTracks, SubtitleTrack } from '@raven/core'
import type { ServerEntry } from '@/main/desktopConfig'
import { PLAYER_MESSAGES, type ServerTarget } from '@/main/player/playerService'
import type { AllowedCall } from '@/main/servers/allowlist'
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
  addedAt: 1,
}
const OTHER_ID = '00000000-0000-4000-8000-000000000002'
const FILE_URL = 'https://raven.example/api/media/7/file'

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

const setup = ({
  answer = () => reply({ status: 200, body: JSON.stringify(TRACKS) }),
  cookies = [{ name: 'raven_unlock', value: 'a.b' }],
  servers = [SERVER],
}: {
  answer?: (call: AllowedCall) => ServerCallResult | null
  cookies?: readonly { name: string; value: string }[]
  servers?: readonly ServerEntry[]
} = {}) => {
  const { calls, made } = fakeCalls({ answer })
  const asked: { serverId: string; url: string }[] = []
  const warnings: string[] = []
  const sources = createServerSources({
    serverOf: (serverId) => servers.find((server) => server.id === serverId) ?? null,
    cookiesFor: async (input) => {
      asked.push(input)
      return cookies
    },
    calls,
    warn: (message) => {
      warnings.push(message)
    },
  })
  return { sources, made, asked, warnings }
}

const TARGET: ServerTarget = {
  kind: 'server',
  serverId: SERVER.id,
  mediaId: 7,
  url: FILE_URL,
  headerFields: 'Cookie: raven_unlock=a.b',
  sidecars: [],
}

const SOURCE = { kind: 'server', serverId: SERVER.id, mediaId: 7 } as const

describe('resolve', () => {
  test('a known server and title give the file URL, the cookie and the external sidecars in order', async () => {
    const { sources, made, asked, warnings } = setup()
    expect(await sources.resolve(SOURCE)).toEqual({
      ok: true,
      target: {
        kind: 'server',
        serverId: SERVER.id,
        mediaId: 7,
        url: FILE_URL,
        headerFields: 'Cookie: raven_unlock=a.b',
        sidecars: [
          {
            url: 'https://raven.example/api/media/7/subtitles/external-0',
            title: 'English SDH',
            language: 'en',
          },
          {
            url: 'https://raven.example/api/media/7/subtitles/external-1',
            title: '',
            language: '',
          },
        ],
      },
    })
    expect(made).toEqual([{ serverId: SERVER.id, call: { name: 'getTracks', mediaId: 7 } }])
    expect(asked).toEqual([{ serverId: SERVER.id, url: FILE_URL }])
    expect(warnings).toEqual([])
  })

  test('only sidecars named external-N are added, so nothing else reaches a path', async () => {
    const odd: MediaTracks = {
      ...TRACKS,
      subtitles: [
        subtitle({ id: '../../lock/unlock?x', source: 'external' }),
        subtitle({ id: 'external-1/../../x', source: 'external' }),
        subtitle({ id: 'external-', source: 'external' }),
        subtitle({ id: 'external-12', source: 'external', language: 'de' }),
      ],
    }
    const { sources } = setup({ answer: () => reply({ status: 200, body: JSON.stringify(odd) }) })
    const resolved = await sources.resolve(SOURCE)
    if (!resolved.ok || resolved.target.kind !== 'server') throw new Error('expected a server')
    expect(resolved.target.sidecars).toEqual([
      {
        url: 'https://raven.example/api/media/7/subtitles/external-12',
        title: '',
        language: 'de',
      },
    ])
  })

  test('tracks held past the timeout give no sidecars, and the title still resolves', async () => {
    jest.useFakeTimers()
    try {
      const { sources, warnings } = setup({ answer: () => null })
      const resolving = sources.resolve(SOURCE)
      jest.advanceTimersByTime(TRACKS_TIMEOUT_MS)
      const resolved = await resolving
      if (!resolved.ok || resolved.target.kind !== 'server') throw new Error('expected a server')
      expect(resolved.target.url).toBe(FILE_URL)
      expect(resolved.target.headerFields).toBe('Cookie: raven_unlock=a.b')
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
    if (!resolved.ok || resolved.target.kind !== 'server') throw new Error('expected a server')
    expect(resolved.target.url).toBe(FILE_URL)
    expect(resolved.target.sidecars).toEqual([])
    expect(warnings.length).toBe(1)
    expect(warnings.join('')).not.toContain('a.b')
    expect(warnings.join('')).not.toContain('https://')
  })

  test('a tracks call that rejects still resolves, with no sidecars and a warning', async () => {
    const warnings: string[] = []
    const sources = createServerSources({
      serverOf: () => SERVER,
      cookiesFor: async () => [],
      calls: { call: () => Promise.reject(new Error('gone')) },
      warn: (message) => {
        warnings.push(message)
      },
    })
    const resolved = await sources.resolve(SOURCE)
    if (!resolved.ok || resolved.target.kind !== 'server') throw new Error('expected a server')
    expect(resolved.target.sidecars).toEqual([])
    expect(warnings).toEqual(['no sidecars from Vhagar: its tracks failed: gone'])
  })

  test('a server id that is not opaque and a media id that is not whole are bad titles that call nothing', async () => {
    const { sources, made, asked } = setup()
    expect(await sources.resolve({ ...SOURCE, serverId: 'vhagar' })).toEqual({
      ok: false,
      message: SOURCE_MESSAGES.badTitle,
    })
    expect(await sources.resolve({ ...SOURCE, mediaId: 7.5 })).toEqual({
      ok: false,
      message: SOURCE_MESSAGES.badTitle,
    })
    expect(made).toEqual([])
    expect(asked).toEqual([])
  })

  test('an unknown server is refused and calls nothing', async () => {
    const { sources, made, asked } = setup()
    expect(await sources.resolve({ ...SOURCE, serverId: OTHER_ID })).toEqual({
      ok: false,
      message: SOURCE_MESSAGES.unknownServer,
    })
    expect(made).toEqual([])
    expect(asked).toEqual([])
  })

  test('no cookies give an empty header, and only the two server cookies make one', async () => {
    const bare = setup({ cookies: [] })
    const resolved = await bare.sources.resolve(SOURCE)
    if (!resolved.ok || resolved.target.kind !== 'server') throw new Error('expected a server')
    expect(resolved.target.headerFields).toBe('')
    const mixed = setup({
      cookies: [
        { name: 'session', value: 'x' },
        { name: 'raven_admin', value: 'c.d' },
        { name: 'raven_unlock', value: 'a.b' },
      ],
    })
    const both = await mixed.sources.resolve(SOURCE)
    if (!both.ok || both.target.kind !== 'server') throw new Error('expected a server')
    expect(both.target.headerFields).toBe('Cookie: raven_unlock=a.b; raven_admin=c.d')
  })
})

describe('explain', () => {
  afterEach(() => {
    jest.useRealTimers()
  })

  test('asks the server for the title once', async () => {
    const { sources, made } = setup({ answer: () => reply({ status: 200, body: '{}' }) })
    await sources.explain({ target: TARGET, phase: 'loaded' })
    expect(made).toEqual([{ serverId: SERVER.id, call: { name: 'getMedia', mediaId: 7 } }])
  })

  test('an unreachable server lost the connection', async () => {
    const { sources } = setup({
      answer: () => ({ ok: false, message: 'raven player could not reach Vhagar.' }),
    })
    expect(await sources.explain({ target: TARGET, phase: 'loaded' })).toEqual({
      reason: 'network',
      message: SOURCE_MESSAGES.lost('Vhagar'),
    })
  })

  test('a call held past the timeout lost the connection', async () => {
    jest.useFakeTimers()
    const { sources } = setup({ answer: () => null })
    const explained = sources.explain({ target: TARGET, phase: 'loading' })
    jest.advanceTimersByTime(EXPLAIN_TIMEOUT_MS)
    expect(await explained).toEqual({ reason: 'network', message: SOURCE_MESSAGES.lost('Vhagar') })
    expect(EXPLAIN_TIMEOUT_MS).toBe(5000)
  })

  test('a 423 is the library locked again', async () => {
    const { sources } = setup({ answer: () => reply({ status: 423, body: '{}' }) })
    expect(await sources.explain({ target: TARGET, phase: 'loaded' })).toEqual({
      reason: 'locked',
      message: 'Vhagar locked this library again.',
    })
  })

  test('a 404 is a title that is gone', async () => {
    const { sources } = setup({ answer: () => reply({ status: 404, body: '{}' }) })
    expect(await sources.explain({ target: TARGET, phase: 'loading' })).toEqual({
      reason: 'open',
      message: SOURCE_MESSAGES.gone('Vhagar'),
    })
  })

  test('a 200 keeps the reason mpv had, by phase', async () => {
    const { sources } = setup({ answer: () => reply({ status: 200, body: '{}' }) })
    expect(await sources.explain({ target: TARGET, phase: 'loading' })).toEqual({
      reason: 'open',
      message: SOURCE_MESSAGES.cannotOpen('Vhagar'),
    })
    expect(await sources.explain({ target: TARGET, phase: 'loaded' })).toEqual({
      reason: 'decode',
      message: PLAYER_MESSAGES.stopped,
    })
  })

  test('a server gone from the config lost the connection to the server, without a call', async () => {
    const { sources, made } = setup({ servers: [] })
    expect(await sources.explain({ target: TARGET, phase: 'loaded' })).toEqual({
      reason: 'network',
      message: SOURCE_MESSAGES.lost('the server'),
    })
    expect(made).toEqual([])
  })

  test("the player's own messages say what the source would", () => {
    expect<string>(PLAYER_MESSAGES.lost).toBe(SOURCE_MESSAGES.lost('the server'))
    expect<string>(PLAYER_MESSAGES.serverGone).toBe(SOURCE_MESSAGES.unknownServer)
  })
})
