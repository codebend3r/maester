import { AUTH_HEADERS, AUTH_REFUSALS, AUTH_SCHEME, SERVER_METHODS } from '@raven/core'
import { describe, expect, it } from 'bun:test'
import { SERVER_GONE, type ServerEntry } from '@/main/desktopConfig'
import { CALL_NAMES, type AllowedCall } from '@/main/servers/allowlist'
import { SOURCE_MESSAGES } from '@/main/servers/serverSources'
import { tokenFor } from '@/main/test/accountTokens'
import { HTTP_HEADERS } from '@/shared/httpHeaders'
import {
  CALL_MESSAGES,
  CALL_TIMEOUT_MS,
  MAX_IN_FLIGHT,
  MAX_REPLY_CHARS,
  MAX_SAGAS_REPLY_CHARS,
  WRITE_RESERVE,
  createServerCalls,
  fetchThrough,
  replyCapFor,
  type ServerCallResult,
  type ServerFetch,
} from '@/main/servers/serverCalls'

type Sent = Parameters<ServerFetch>[0]
const ANSWER_KINDS = {
  reply: 'reply',
  hold: 'hold',
  reject: 'reject',
  failText: 'failText',
} as const

type Answer =
  | { kind: typeof ANSWER_KINDS.reply; status: number; text: string }
  | { kind: typeof ANSWER_KINDS.hold; status: number; text: string }
  | { kind: typeof ANSWER_KINDS.reject }
  | { kind: typeof ANSWER_KINDS.failText }

const SERVER: ServerEntry = {
  id: '00000000-0000-4000-8000-000000000001',
  origin: 'https://raven.example',
  name: 'raven.example',
}

const OTHER: ServerEntry = {
  id: '00000000-0000-4000-8000-000000000002',
  origin: 'https://other.example',
  name: 'other.example',
}

type ReplyProps = { status?: number; text?: string }

const reply = ({ status = 200, text = '{}' }: ReplyProps = {}): Answer => ({
  kind: ANSWER_KINDS.reply,
  status,
  text,
})

type FakeFetchProps = { answer?: (sent: Sent) => Answer }

/** A `ServerFetch` that records what it was sent and answers from `answer`, holding a reply until it is released. */
const fakeFetch = ({ answer = () => reply() }: FakeFetchProps = {}) => {
  const sent: Sent[] = []
  const held: (() => void)[] = []
  const fetch: ServerFetch = (input) => {
    sent.push(input)
    const answered = answer(input)
    switch (answered.kind) {
      case ANSWER_KINDS.reply:
        return Promise.resolve({
          status: answered.status,
          text: () => Promise.resolve(answered.text),
        })
      case ANSWER_KINDS.hold:
        return new Promise((resolve) => {
          held.push(() =>
            resolve({ status: answered.status, text: () => Promise.resolve(answered.text) }),
          )
        })
      case ANSWER_KINDS.reject:
        return Promise.reject(new Error('net::ERR_CONNECTION_REFUSED'))
      case ANSWER_KINDS.failText:
        return Promise.resolve({
          status: 200,
          text: () => Promise.reject(new Error('The operation was aborted due to timeout')),
        })
      default: {
        const unreachable: never = answered
        return unreachable
      }
    }
  }
  type ReleaseProps = { index: number }

  const release = ({ index }: ReleaseProps): void => {
    const resolve = held.at(index) ?? (() => undefined)
    resolve()
  }
  const releaseAll = (): void => {
    held.forEach((resolve) => resolve())
  }
  return { fetch, sent, release, releaseAll }
}

type SetupPropsAuthorizeProps = { serverId: string }

type UnlockOfProps = { serverId: string }

type SetupProps = {
  answer?: (sent: Sent) => Answer
  servers?: readonly ServerEntry[]
  isWarnBroken?: boolean
  authorize?: (input: SetupPropsAuthorizeProps) => string | null
  unlockOf?: (input: UnlockOfProps) => Promise<string | null>
}

const setup = ({
  answer,
  servers = [SERVER, OTHER],
  isWarnBroken = false,
  authorize = () => null,
  unlockOf = async () => null,
}: SetupProps = {}) => {
  const fake = fakeFetch({ answer })
  const warnings: string[] = []
  const calls = createServerCalls({
    serverOf: (serverId) => servers.find((server) => server.id === serverId) ?? null,
    fetch: fake.fetch,
    authorize,
    unlockOf,
    warn: (message) => {
      warnings.push(message)
      if (isWarnBroken) throw new Error('the log is gone')
    },
  })
  return { ...fake, calls, warnings }
}

const flush = (): Promise<void> => new Promise((resolve) => setImmediate(resolve))

describe('SERVER_GONE', () => {
  it("is main's one message for a server it no longer reaches, written out here", () => {
    expect(SERVER_GONE).toBe('Raven no longer plays from that server.')
    expect(CALL_MESSAGES.unknownServer).toBe(SERVER_GONE)
    expect(SOURCE_MESSAGES.unknownServer).toBe(SERVER_GONE)
  })
})

describe('the call values', () => {
  it('has the timeout, the reply cap, the in-flight cap and the messages', () => {
    expect(CALL_TIMEOUT_MS).toBe(10_000)
    expect(MAX_REPLY_CHARS).toBe(1_048_576)
    expect(MAX_SAGAS_REPLY_CHARS).toBe(8 * 1_048_576)
    expect(MAX_IN_FLIGHT).toBe(6)
    expect(WRITE_RESERVE).toBe(2)
    expect(CALL_MESSAGES.offList).toBe('Raven does not make that call.')
    expect(CALL_MESSAGES.unreachable('raven.example')).toBe('Raven could not reach raven.example.')
    expect(CALL_MESSAGES.tooBig('raven.example')).toBe('raven.example sent more than Raven reads.')
    expect(CALL_MESSAGES.busy('raven.example')).toBe('Raven is still waiting on raven.example.')
    expect(CALL_MESSAGES.otherAccount('raven.example')).toBe(
      'Raven is signed in to raven.example as someone else now.',
    )
  })
})

describe('fetchThrough', () => {
  it('never follows a redirect, times out, sends no jar cookie and passes the request on', async () => {
    const seen: { url: string; init: RequestInit }[] = []
    const through = fetchThrough((url, init) => {
      seen.push({ url, init })
      return Promise.resolve(new Response('{"a":1}', { status: 201 }))
    })
    const answer = await through({
      url: 'https://raven.example/api/media/7/progress',
      method: SERVER_METHODS.put,
      headers: { accept: 'application/json', 'content-type': 'application/json' },
      body: '{"position":40}',
      timeoutMs: 5,
    })
    expect(answer.status).toBe(201)
    expect(await answer.text({ maxChars: MAX_REPLY_CHARS })).toBe('{"a":1}')
    expect(seen).toHaveLength(1)
    const [{ url, init }] = seen
    expect(url).toBe('https://raven.example/api/media/7/progress')
    expect(init.method).toBe(SERVER_METHODS.put)
    expect(init.headers).toEqual({ accept: 'application/json', 'content-type': 'application/json' })
    expect(init.body).toBe('{"position":40}')
    expect(init.redirect).toBe('error')
    expect(init.credentials).toBe('omit')
    expect(init.signal).toBeInstanceOf(AbortSignal)
  })

  it('sends no body for null', async () => {
    const seen: RequestInit[] = []
    const through = fetchThrough((_url, init) => {
      seen.push(init)
      return Promise.resolve(new Response('{}'))
    })
    await through({
      url: 'https://raven.example/api/lock',
      method: SERVER_METHODS.get,
      headers: { accept: 'application/json' },
      body: null,
      timeoutMs: 5,
    })
    expect(seen).toHaveLength(1)
    const [init] = seen
    expect(init.body).toBeUndefined()
  })

  it('stops reading a reply once it is past MAX_REPLY_CHARS', async () => {
    const through = fetchThrough(() =>
      Promise.resolve(new Response('x'.repeat(MAX_REPLY_CHARS * 4))),
    )
    const answer = await through({
      url: 'https://raven.example/api/lock',
      method: SERVER_METHODS.get,
      headers: {},
      body: null,
      timeoutMs: 1000,
    })
    const text = await answer.text({ maxChars: MAX_REPLY_CHARS })
    expect(text.length).toBeGreaterThan(MAX_REPLY_CHARS)
    expect(text.length).toBeLessThan(MAX_REPLY_CHARS * 4)
  })

  it('reads a reply up to the cap it is given', async () => {
    const through = fetchThrough(() =>
      Promise.resolve(new Response('x'.repeat(MAX_REPLY_CHARS * 2))),
    )
    const answer = await through({
      url: 'https://raven.example/api/libraries/3/sagas',
      method: SERVER_METHODS.get,
      headers: {},
      body: null,
      timeoutMs: 1000,
    })
    expect(await answer.text({ maxChars: MAX_SAGAS_REPLY_CHARS })).toHaveLength(MAX_REPLY_CHARS * 2)
  })

  it('reads a reply with no body as empty text', async () => {
    const through = fetchThrough(() => Promise.resolve(new Response(null, { status: 204 })))
    const answer = await through({
      url: 'https://raven.example/api/media/1/plays',
      method: SERVER_METHODS.post,
      headers: {},
      body: null,
      timeoutMs: 1000,
    })
    expect(answer.status).toBe(204)
    expect(await answer.text({ maxChars: MAX_REPLY_CHARS })).toBe('')
  })

  describe('against a real server', () => {
    it('fails on a redirect instead of following it to another origin', async () => {
      const evilHits: string[] = []
      const evil = Bun.serve({
        port: 0,
        fetch: (request) => {
          evilHits.push(request.headers.get('cookie') ?? '')
          return new Response('{"available":true,"unlocked":true}')
        },
      })
      const raven = Bun.serve({
        port: 0,
        fetch: () => Response.redirect(`http://127.0.0.1:${evil.port}/api/lock`, 302),
      })
      try {
        const through = fetchThrough(globalThis.fetch)
        const outcome = await through({
          url: `http://127.0.0.1:${raven.port}/api/lock`,
          method: SERVER_METHODS.get,
          headers: { accept: 'application/json', cookie: 'raven_unlock=secret' },
          body: null,
          timeoutMs: 5000,
        }).then(
          () => 'answered',
          () => 'failed',
        )
        expect(outcome).toBe('failed')
        expect(evilHits).toEqual([])
      } finally {
        await Promise.all([evil.stop(true), raven.stop(true)])
      }
    })

    it('gives up on a server that never sends its headers', async () => {
      const stalled = Bun.serve({
        port: 0,
        fetch: () => new Promise<Response>(() => undefined),
      })
      try {
        const startedAt = performance.now()
        const outcome = await fetchThrough(globalThis.fetch)({
          url: `http://127.0.0.1:${stalled.port}/api/lock`,
          method: SERVER_METHODS.get,
          headers: { accept: 'application/json' },
          body: null,
          timeoutMs: 50,
        }).then(
          () => 'answered',
          () => 'failed',
        )
        expect(outcome).toBe('failed')
        expect(performance.now() - startedAt).toBeLessThan(3000)
      } finally {
        await stalled.stop(true)
      }
    })

    it('gives up on a reply whose body stops part way', async () => {
      const stalled = Bun.serve({
        port: 0,
        fetch: () =>
          new Response(
            new ReadableStream({
              start: (controller) => {
                controller.enqueue(new TextEncoder().encode('{"available":'))
              },
            }),
            { headers: { 'content-type': 'application/json' } },
          ),
      })
      try {
        const startedAt = performance.now()
        const answer = await fetchThrough(globalThis.fetch)({
          url: `http://127.0.0.1:${stalled.port}/api/lock`,
          method: SERVER_METHODS.get,
          headers: { accept: 'application/json' },
          body: null,
          timeoutMs: 50,
        })
        expect(answer.status).toBe(200)
        const outcome = await answer.text({ maxChars: MAX_REPLY_CHARS }).then(
          () => 'read',
          () => 'failed',
        )
        expect(outcome).toBe('failed')
        expect(performance.now() - startedAt).toBeLessThan(3000)
      } finally {
        await stalled.stop(true)
      }
    })
  })
})

describe('createServerCalls.call', () => {
  it('fetches the path from the stored origin with JSON accepted and no body', async () => {
    const { calls, sent } = setup({
      answer: () => reply({ text: '{"id":7}' }),
    })
    const result = await calls.call({
      serverId: SERVER.id,
      call: { name: CALL_NAMES.getMedia, mediaId: 7 },
    })
    expect(result).toEqual({ ok: true, status: 200, body: '{"id":7}' })
    expect(sent).toEqual([
      {
        url: 'https://raven.example/api/media/7',
        method: SERVER_METHODS.get,
        headers: { accept: 'application/json' },
        body: null,
        timeoutMs: CALL_TIMEOUT_MS,
      },
    ])
  })

  it("sends the page's unlock as the cookie, read for the server on every call", async () => {
    const asked: string[] = []
    const { calls, sent } = setup({
      unlockOf: async ({ serverId }) => {
        asked.push(serverId)
        return serverId === SERVER.id ? 'raven_unlock=a.b.c' : null
      },
    })
    await calls.call({
      serverId: SERVER.id,
      call: { name: CALL_NAMES.getAccountTicket, mediaId: 7 },
    })
    await calls.call({ serverId: OTHER.id, call: { name: CALL_NAMES.getMedia, mediaId: 7 } })
    expect(asked).toEqual([SERVER.id, OTHER.id])
    expect(sent.map(({ headers }) => headers)).toEqual([
      { accept: 'application/json', cookie: 'raven_unlock=a.b.c' },
      { accept: 'application/json' },
    ])
  })

  it('answers unreachable when the unlock cannot be read, and never fetches', async () => {
    const { calls, sent, warnings } = setup({
      unlockOf: () => Promise.reject(new Error('jar shut')),
    })
    expect(
      await calls.call({ serverId: SERVER.id, call: { name: CALL_NAMES.getMediaOrigins } }),
    ).toEqual({ ok: false, message: CALL_MESSAGES.unreachable('raven.example') })
    expect(sent).toEqual([])
    expect(warnings).toHaveLength(1)
  })

  it('sends a content type and the rebuilt body with a saveProgress', async () => {
    const { calls, sent } = setup({ answer: () => reply({ status: 204, text: '' }) })
    const result = await calls.call({
      serverId: SERVER.id,
      call: { name: CALL_NAMES.saveProgress, mediaId: 7, position: 40, audio: null },
    })
    expect(result).toEqual({ ok: true, status: 204, body: '' })
    expect(sent).toEqual([
      {
        url: 'https://raven.example/api/media/7/progress',
        method: SERVER_METHODS.put,
        headers: { accept: 'application/json', 'content-type': 'application/json' },
        body: '{"position":40,"audio":null}',
        timeoutMs: CALL_TIMEOUT_MS,
      },
    ])
  })

  it('answers unknownServer for a server it does not hold, and never fetches', async () => {
    const { calls, sent } = setup()
    const result = await calls.call({
      serverId: 'gone',
      call: { name: CALL_NAMES.getMediaOrigins },
    })
    expect(result).toEqual({ ok: false, message: CALL_MESSAGES.unknownServer })
    expect(sent).toEqual([])
  })

  it('answers unreachable and warns when the fetch rejects, without the token or the unlock', async () => {
    const { calls, warnings } = setup({
      answer: () => ({ kind: ANSWER_KINDS.reject }),
      authorize: () => 'very-secret-token',
      unlockOf: async () => 'raven_unlock=very-secret-unlock',
    })
    const result = await calls.call({
      serverId: SERVER.id,
      call: { name: CALL_NAMES.recordPlay, mediaId: 7 },
    })
    expect(result).toEqual({ ok: false, message: CALL_MESSAGES.unreachable('raven.example') })
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain('raven.example')
    expect(warnings[0]).toContain('POST /api/media/7/plays')
    expect(warnings[0]).not.toContain('very-secret')
  })

  it('answers unreachable when reading the reply fails', async () => {
    const { calls, warnings } = setup({ answer: () => ({ kind: ANSWER_KINDS.failText }) })
    const result = await calls.call({
      serverId: SERVER.id,
      call: { name: CALL_NAMES.getMediaOrigins },
    })
    expect(result).toEqual({ ok: false, message: CALL_MESSAGES.unreachable('raven.example') })
    expect(warnings).toHaveLength(1)
  })

  it('answers unreachable when the fetch throws at once', async () => {
    const warnings: string[] = []
    const calls = createServerCalls({
      serverOf: () => SERVER,
      fetch: () => {
        throw new Error('no network')
      },
      authorize: () => null,
      unlockOf: async () => null,
      warn: (message) => {
        warnings.push(message)
      },
    })
    const result = await calls.call({
      serverId: SERVER.id,
      call: { name: CALL_NAMES.getMediaOrigins },
    })
    expect(result).toEqual({ ok: false, message: CALL_MESSAGES.unreachable('raven.example') })
    expect(warnings).toHaveLength(1)
  })

  it('answers tooBig for a 2 MB reply, and passes one of exactly MAX_REPLY_CHARS', async () => {
    const big = setup({ answer: () => reply({ text: 'x'.repeat(2 * 1024 * 1024) }) })
    expect(
      await big.calls.call({ serverId: SERVER.id, call: { name: CALL_NAMES.getMediaOrigins } }),
    ).toEqual({
      ok: false,
      message: CALL_MESSAGES.tooBig('raven.example'),
    })
    const edge = setup({ answer: () => reply({ text: 'x'.repeat(MAX_REPLY_CHARS) }) })
    const result = await edge.calls.call({
      serverId: SERVER.id,
      call: { name: CALL_NAMES.getMediaOrigins },
    })
    expect(result.ok).toBe(true)
  })

  describe('the reply cap', () => {
    const PAST_ONE_MIB = 'x'.repeat(MAX_REPLY_CHARS * 2)

    type StreamingProps = { text: string }

    /** Server calls over `fetchThrough`, so the cap is the one the real stream read keeps. */
    const streaming = ({ text }: StreamingProps) =>
      createServerCalls({
        serverOf: () => SERVER,
        fetch: fetchThrough(() => Promise.resolve(new Response(text))),
        authorize: () => null,
        unlockOf: async () => null,
        warn: () => undefined,
      })

    it('reads getSagas up to MAX_SAGAS_REPLY_CHARS and every other call up to MAX_REPLY_CHARS', () => {
      expect(replyCapFor({ name: CALL_NAMES.getSagas, libraryId: 3 })).toBe(MAX_SAGAS_REPLY_CHARS)
      expect(replyCapFor({ name: CALL_NAMES.getLibrary, libraryId: 3 })).toBe(MAX_REPLY_CHARS)
      expect(replyCapFor({ name: CALL_NAMES.getItem, itemId: 3 })).toBe(MAX_REPLY_CHARS)
      expect(replyCapFor({ name: CALL_NAMES.getMediaOrigins })).toBe(MAX_REPLY_CHARS)
    })

    it('reads a getSagas reply past 1 MiB and under 8 MiB whole', async () => {
      const calls = streaming({ text: PAST_ONE_MIB })
      expect(
        await calls.call({
          serverId: SERVER.id,
          call: { name: CALL_NAMES.getSagas, libraryId: 3 },
        }),
      ).toEqual({ ok: true, status: 200, body: PAST_ONE_MIB })
    })

    it("still cuts another call's reply past 1 MiB", async () => {
      const calls = streaming({ text: PAST_ONE_MIB })
      expect(
        await calls.call({
          serverId: SERVER.id,
          call: { name: CALL_NAMES.getLibrary, libraryId: 3 },
        }),
      ).toEqual({ ok: false, message: CALL_MESSAGES.tooBig('raven.example') })
    })

    it('answers tooBig for a getSagas reply past MAX_SAGAS_REPLY_CHARS', async () => {
      const { calls } = setup({
        answer: () => reply({ text: 'x'.repeat(MAX_SAGAS_REPLY_CHARS + 1) }),
      })
      expect(
        await calls.call({
          serverId: SERVER.id,
          call: { name: CALL_NAMES.getSagas, libraryId: 3 },
        }),
      ).toEqual({ ok: false, message: CALL_MESSAGES.tooBig('raven.example') })
    })
  })

  it('passes an error status and its body on for the page to read', async () => {
    const { calls } = setup({ answer: () => reply({ status: 500, text: '<html>' }) })
    expect(
      await calls.call({ serverId: SERVER.id, call: { name: CALL_NAMES.getMedia, mediaId: 1 } }),
    ).toEqual({ ok: true, status: 500, body: '<html>' })
  })

  it('passes a 423 and a 404 on as they are', async () => {
    const locked = setup({ answer: () => reply({ status: 423, text: '{"message":"Locked"}' }) })
    expect(
      await locked.calls.call({
        serverId: SERVER.id,
        call: { name: CALL_NAMES.getMedia, mediaId: 1 },
      }),
    ).toEqual({ ok: true, status: 423, body: '{"message":"Locked"}' })
    const gone = setup({ answer: () => reply({ status: 404, text: '{}' }) })
    expect(
      await gone.calls.call({
        serverId: SERVER.id,
        call: { name: CALL_NAMES.getMedia, mediaId: 1 },
      }),
    ).toEqual({ ok: true, status: 404, body: '{}' })
  })

  it('answers busy for a seventh call held at once, without fetching it', async () => {
    const { calls, sent, releaseAll } = setup({
      answer: () => ({ kind: ANSWER_KINDS.hold, status: 200, text: '{}' }),
    })
    const held = Array.from({ length: MAX_IN_FLIGHT }, (_, n) =>
      calls.call({ serverId: SERVER.id, call: { name: CALL_NAMES.getMedia, mediaId: n + 1 } }),
    )
    const seventh = await calls.call({
      serverId: SERVER.id,
      call: { name: CALL_NAMES.getMediaOrigins },
    })
    expect(seventh).toEqual({ ok: false, message: CALL_MESSAGES.busy('raven.example') })
    await flush()
    expect(sent).toHaveLength(MAX_IN_FLIGHT)
    releaseAll()
    const answers = await Promise.all(held)
    expect(answers.every((answer) => answer.ok)).toBe(true)
  })

  it('keeps WRITE_RESERVE slots that reads cannot take, so six held reads never starve a save', async () => {
    const { calls, sent, releaseAll } = setup({
      answer: () => ({ kind: ANSWER_KINDS.hold, status: 204, text: '' }),
    })
    const reads = Array.from({ length: MAX_IN_FLIGHT }, (_, n) =>
      calls.call({ serverId: SERVER.id, call: { name: CALL_NAMES.getMedia, mediaId: n + 1 } }),
    )
    const save = calls.call({
      serverId: SERVER.id,
      call: { name: CALL_NAMES.saveProgress, mediaId: 1, position: 5, audio: null },
    })
    const ticket = calls.call({
      serverId: SERVER.id,
      call: { name: CALL_NAMES.getAccountTicket, mediaId: 1 },
    })
    await flush()
    expect(sent).toHaveLength(MAX_IN_FLIGHT + WRITE_RESERVE)
    expect(sent.map((input) => input.method).slice(MAX_IN_FLIGHT)).toEqual([
      SERVER_METHODS.put,
      SERVER_METHODS.post,
    ])
    expect(
      await calls.call({ serverId: SERVER.id, call: { name: CALL_NAMES.recordPlay, mediaId: 1 } }),
    ).toEqual({ ok: false, message: CALL_MESSAGES.busy('raven.example') })
    await flush()
    expect(sent).toHaveLength(MAX_IN_FLIGHT + WRITE_RESERVE)
    releaseAll()
    const answers = await Promise.all([...reads, save, ticket])
    expect(answers.every((answer) => answer.ok)).toBe(true)
  })

  it('refuses a read once MAX_IN_FLIGHT writes are held, while a write still goes', async () => {
    const { calls, sent, releaseAll } = setup({
      answer: () => ({ kind: ANSWER_KINDS.hold, status: 204, text: '' }),
    })
    const writes = Array.from({ length: MAX_IN_FLIGHT }, (_, n) =>
      calls.call({ serverId: SERVER.id, call: { name: CALL_NAMES.recordPlay, mediaId: n + 1 } }),
    )
    expect(
      await calls.call({ serverId: SERVER.id, call: { name: CALL_NAMES.getMediaOrigins } }),
    ).toEqual({
      ok: false,
      message: CALL_MESSAGES.busy('raven.example'),
    })
    const save = calls.call({
      serverId: SERVER.id,
      call: { name: CALL_NAMES.saveProgress, mediaId: 1, position: 5, audio: null },
    })
    await flush()
    expect(sent).toHaveLength(MAX_IN_FLIGHT + 1)
    releaseAll()
    await Promise.all([...writes, save])
  })

  it('counts calls in flight per server and frees a slot once a call settles', async () => {
    const { calls, sent, release } = setup({
      answer: (input) =>
        input.url.startsWith(SERVER.origin)
          ? { kind: ANSWER_KINDS.hold, status: 200, text: '{}' }
          : reply(),
    })
    const held = Array.from({ length: MAX_IN_FLIGHT }, () =>
      calls.call({ serverId: SERVER.id, call: { name: CALL_NAMES.getMediaOrigins } }),
    )
    expect(
      await calls.call({ serverId: OTHER.id, call: { name: CALL_NAMES.getMediaOrigins } }),
    ).toEqual({
      ok: true,
      status: 200,
      body: '{}',
    })
    release({ index: 0 })
    await held[0]
    const next = calls.call({ serverId: SERVER.id, call: { name: CALL_NAMES.getMediaOrigins } })
    await flush()
    expect(sent.filter((input) => input.url.startsWith(SERVER.origin))).toHaveLength(
      MAX_IN_FLIGHT + 1,
    )
    release({ index: MAX_IN_FLIGHT })
    expect((await next).ok).toBe(true)
  })

  it('frees a slot after a call that failed', async () => {
    const { calls, sent } = setup({ answer: () => ({ kind: ANSWER_KINDS.reject }) })
    await Promise.all(
      Array.from({ length: MAX_IN_FLIGHT }, () =>
        calls.call({ serverId: SERVER.id, call: { name: CALL_NAMES.getMediaOrigins } }),
      ),
    )
    await calls.call({ serverId: SERVER.id, call: { name: CALL_NAMES.getMediaOrigins } })
    expect(sent).toHaveLength(MAX_IN_FLIGHT + 1)
  })
})

describe('createServerCalls with the page signed in', () => {
  const ACCOUNT_A = '30000000-0000-4000-8000-00000000000a'
  const ACCOUNT_B = '30000000-0000-4000-8000-00000000000b'
  const TOKEN = 'access-token-one'
  const ORIGINS = { name: CALL_NAMES.getMediaOrigins } as const

  type TokensOfProps = { tokens: readonly (string | null)[] }

  /** Hands out `tokens` in order, one per call, and notes which server each was for. */
  const tokensOf = ({ tokens }: TokensOfProps) => {
    const asked: string[] = []
    const queue = [...tokens]
    type AuthorizeProps = { serverId: string }

    const authorize = ({ serverId }: AuthorizeProps): string | null => {
      asked.push(serverId)
      return queue.shift() ?? null
    }
    return { authorize, asked }
  }

  const authorizationOf = (sent: Sent): string | undefined =>
    sent.headers[AUTH_HEADERS.authorization]

  it('sends no header while the page is signed out', async () => {
    const { authorize, asked } = tokensOf({ tokens: [null] })
    const { calls, sent } = setup({ authorize })
    await calls.call({ serverId: SERVER.id, call: ORIGINS })
    expect(asked).toEqual([SERVER.id])
    expect(sent.map(authorizationOf)).toEqual([undefined])
    expect(Object.keys(sent[0]?.headers ?? {})).toEqual([HTTP_HEADERS.accept])
  })

  it("sends Authorization: Bearer <the page's token> on every call", async () => {
    const { authorize } = tokensOf({ tokens: [TOKEN, TOKEN] })
    const { calls, sent } = setup({ authorize })
    await calls.call({ serverId: SERVER.id, call: ORIGINS })
    await calls.call({
      serverId: SERVER.id,
      call: { name: CALL_NAMES.saveProgress, mediaId: 7, position: 3, audio: null },
    })
    expect(sent.map(authorizationOf)).toEqual([
      `${AUTH_SCHEME} ${TOKEN}`,
      `${AUTH_SCHEME} ${TOKEN}`,
    ])
  })

  it('sends a call made for an account only under a token issued to that account', async () => {
    const asA = tokenFor({ accountId: ACCOUNT_A })
    const asB = tokenFor({ accountId: ACCOUNT_B })
    const { authorize } = tokensOf({ tokens: [asA, asB, null] })
    const { calls, sent } = setup({ authorize })
    const PLAY = { name: CALL_NAMES.recordPlay, mediaId: 7 } as const
    const forA = { serverId: SERVER.id, call: PLAY, accountId: ACCOUNT_A }
    expect((await calls.call(forA)).ok).toBe(true)
    const refused: ServerCallResult = {
      ok: false,
      message: CALL_MESSAGES.otherAccount(SERVER.name),
    }
    expect(await calls.call(forA)).toEqual(refused)
    expect(await calls.call(forA)).toEqual(refused)
    expect(sent.map(authorizationOf)).toEqual([`${AUTH_SCHEME} ${asA}`])
  })

  it('does not ask for a token for a server it does not hold', async () => {
    const { authorize, asked } = tokensOf({ tokens: [TOKEN] })
    const { calls, sent } = setup({ authorize })
    await calls.call({ serverId: '00000000-0000-4000-8000-0000000000ff', call: ORIGINS })
    expect(asked).toEqual([])
    expect(sent).toEqual([])
  })

  it('passes a 401 on as it came, since the page renews its own session', async () => {
    const signedOut = JSON.stringify({ reason: AUTH_REFUSALS.signedOut })
    const { authorize } = tokensOf({ tokens: [TOKEN, TOKEN] })
    const { calls, sent } = setup({
      authorize,
      answer: () => reply({ status: 401, text: signedOut }),
    })
    expect(await calls.call({ serverId: SERVER.id, call: ORIGINS })).toEqual({
      ok: true,
      status: 401,
      body: signedOut,
    })
    expect(sent).toHaveLength(1)
  })

  it('never puts a token in a warning', async () => {
    const { warnings, calls } = setup({
      authorize: () => TOKEN,
      answer: () => ({ kind: ANSWER_KINDS.reject }),
    })
    await calls.call({ serverId: SERVER.id, call: ORIGINS })
    expect(warnings.join('\n')).not.toContain(TOKEN)
  })
})

describe('createServerCalls.call refuses a call that slipped past the types', () => {
  // A guard that passes any value, so a test can hand over what a compromised caller
  // would without a cast: the calls must refuse it on their own.
  const passesAnything = (value: unknown): value is AllowedCall => value !== undefined
  type ForgeProps = { fields: Record<string, unknown> }

  const forge = ({ fields }: ForgeProps): AllowedCall => {
    if (!passesAnything(fields)) throw new Error('a forged call needs fields')
    return fields
  }

  type RefusedProps = { forged: AllowedCall }

  const refused = async ({ forged }: RefusedProps): Promise<void> => {
    const { calls, sent, warnings } = setup()
    expect(await calls.call({ serverId: SERVER.id, call: forged })).toEqual({
      ok: false,
      message: CALL_MESSAGES.offList,
    })
    expect(sent).toEqual([])
    expect(warnings).toHaveLength(1)
  }

  it('refuses a string media id that would walk the path', async () => {
    await refused({
      forged: forge({ fields: { name: CALL_NAMES.getMedia, mediaId: '1/../../admin' } }),
    })
  })

  it('refuses a media id that is not a whole number above 0', async () => {
    await refused({ forged: { name: CALL_NAMES.getTracks, mediaId: 1.5 } })
    await refused({ forged: { name: CALL_NAMES.recordPlay, mediaId: 0 } })
    await refused({ forged: { name: CALL_NAMES.getMedia, mediaId: Number.MAX_SAFE_INTEGER + 2 } })
  })

  it('refuses a position that is not a spot in the file', async () => {
    await refused({
      forged: { name: CALL_NAMES.saveProgress, mediaId: 1, position: Number.NaN, audio: null },
    })
    await refused({
      forged: { name: CALL_NAMES.saveProgress, mediaId: 1, position: -1, audio: null },
    })
  })

  it('refuses a call name it does not know', async () => {
    await refused({ forged: forge({ fields: { name: 'deleteLibrary', mediaId: 1 } }) })
  })
})

describe('createServerCalls log lines', () => {
  const HIDDEN = '\u202e\u200b\u2028\u2029\ufeff\r\n'

  it('escapes the server name it logs', async () => {
    const odd: ServerEntry = { ...SERVER, name: `raven${HIDDEN}FORGED` }
    const { calls, warnings } = setup({
      servers: [odd],
      answer: () => ({ kind: ANSWER_KINDS.reject }),
    })
    await calls.call({ serverId: odd.id, call: { name: CALL_NAMES.getMediaOrigins } })
    const big = setup({
      servers: [odd],
      answer: () => reply({ text: 'x'.repeat(MAX_REPLY_CHARS + 1) }),
    })
    await big.calls.call({ serverId: odd.id, call: { name: CALL_NAMES.getMediaOrigins } })
    const lines = [...warnings, ...big.warnings]
    expect(lines).toHaveLength(2)
    expect(lines.every((line) => !/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(line))).toBe(true)
  })

  it('answers every call when the log throws', async () => {
    const down = setup({ answer: () => ({ kind: ANSWER_KINDS.reject }), isWarnBroken: true })
    expect(
      await down.calls.call({ serverId: SERVER.id, call: { name: CALL_NAMES.getMediaOrigins } }),
    ).toEqual({
      ok: false,
      message: CALL_MESSAGES.unreachable('raven.example'),
    })
    const save = down.calls.call({
      serverId: SERVER.id,
      call: { name: CALL_NAMES.saveProgress, mediaId: 1, position: 5, audio: null },
    })
    await down.calls.settleWrites()
    expect(await save).toEqual({ ok: false, message: CALL_MESSAGES.unreachable('raven.example') })
    expect(down.calls.hasPendingWrites()).toBe(false)
    const big = setup({
      answer: () => reply({ text: 'x'.repeat(MAX_REPLY_CHARS + 1) }),
      isWarnBroken: true,
    })
    expect(
      await big.calls.call({ serverId: SERVER.id, call: { name: CALL_NAMES.getMediaOrigins } }),
    ).toEqual({
      ok: false,
      message: CALL_MESSAGES.tooBig('raven.example'),
    })
    expect(down.warnings.length).toBeGreaterThan(0)
  })
})

describe('pending writes', () => {
  it('holds settleWrites until a held saveProgress is released', async () => {
    const { calls, release } = setup({
      answer: () => ({ kind: ANSWER_KINDS.hold, status: 204, text: '' }),
    })
    expect(calls.hasPendingWrites()).toBe(false)
    const save = calls.call({
      serverId: SERVER.id,
      call: { name: CALL_NAMES.saveProgress, mediaId: 1, position: 5, audio: null },
    })
    expect(calls.hasPendingWrites()).toBe(true)
    const progress = { isSettled: false }
    const settled = calls.settleWrites().then(() => Object.assign(progress, { isSettled: true }))
    await flush()
    expect(progress.isSettled).toBe(false)
    release({ index: 0 })
    await settled
    expect(progress.isSettled).toBe(true)
    expect(calls.hasPendingWrites()).toBe(false)
    expect((await save).ok).toBe(true)
  })

  it('does not count a held read', async () => {
    const { calls, releaseAll } = setup({
      answer: () => ({ kind: ANSWER_KINDS.hold, status: 200, text: '{}' }),
    })
    const read = calls.call({
      serverId: SERVER.id,
      call: { name: CALL_NAMES.getMedia, mediaId: 1 },
    })
    expect(calls.hasPendingWrites()).toBe(false)
    await calls.settleWrites()
    releaseAll()
    await read
  })

  it('counts recordPlay as a write', async () => {
    const { calls, releaseAll } = setup({
      answer: () => ({ kind: ANSWER_KINDS.hold, status: 204, text: '' }),
    })
    const play = calls.call({
      serverId: SERVER.id,
      call: { name: CALL_NAMES.recordPlay, mediaId: 1 },
    })
    expect(calls.hasPendingWrites()).toBe(true)
    await flush()
    releaseAll()
    await play
    expect(calls.hasPendingWrites()).toBe(false)
  })

  it('waits only for the writes in flight when it was called', async () => {
    const { calls, release } = setup({
      answer: () => ({ kind: ANSWER_KINDS.hold, status: 204, text: '' }),
    })
    const first = calls.call({
      serverId: SERVER.id,
      call: { name: CALL_NAMES.saveProgress, mediaId: 1, position: 5, audio: null },
    })
    const settled = calls.settleWrites()
    const second = calls.call({
      serverId: SERVER.id,
      call: { name: CALL_NAMES.recordPlay, mediaId: 1 },
    })
    await flush()
    release({ index: 0 })
    await settled
    expect(calls.hasPendingWrites()).toBe(true)
    release({ index: 1 })
    await Promise.all([first, second])
    expect(calls.hasPendingWrites()).toBe(false)
  })

  it('settles a write that failed', async () => {
    const { calls } = setup({ answer: () => ({ kind: ANSWER_KINDS.reject }) })
    const save = calls.call({
      serverId: SERVER.id,
      call: { name: CALL_NAMES.saveProgress, mediaId: 1, position: 5, audio: null },
    })
    await calls.settleWrites()
    expect(calls.hasPendingWrites()).toBe(false)
    expect((await save).ok).toBe(false)
  })
})
