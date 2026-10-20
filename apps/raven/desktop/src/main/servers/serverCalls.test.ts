import { describe, expect, it } from 'bun:test'
import { AUTH_CONFIG_STATES, AUTH_HEADERS, AUTH_REFUSALS, AUTH_SCHEME } from '@raven/core'
import type { ServerEntry } from '@/main/desktopConfig'
import { PLAYER_MESSAGES } from '@/main/player/playerService'
import { API_PATHS, CALL_NAMES, requestFor, type AllowedCall } from '@/main/servers/allowlist'
import { SOURCE_MESSAGES } from '@/main/servers/serverSources'
import { createTitleSittings, type TitleSittings } from '@/main/servers/titleSittings'
import { tokenFor } from '@/main/test/accountTokens'
import { HTTP_HEADERS } from '@/shared/httpHeaders'
import { SERVER_GONE, SERVER_METHODS } from '@/shared/protocol'
import {
  CALL_MESSAGES,
  CALL_TIMEOUT_MS,
  MAX_IN_FLIGHT,
  MAX_REPLY_CHARS,
  MAX_SAGAS_REPLY_CHARS,
  NO_BEARER,
  PROBE_KINDS,
  WRITE_RESERVE,
  createServerCalls,
  fetchThrough,
  probeServer,
  replyCapFor,
  type Bearer,
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
  addedAt: 1,
  signIn: null,
}

const OTHER: ServerEntry = {
  id: '00000000-0000-4000-8000-000000000002',
  origin: 'https://other.example',
  name: 'other.example',
  addedAt: 2,
  signIn: null,
}

const LOCK_STATE = '{"available":true,"unlocked":false}'

const reply = ({ status = 200, text = '{}' }: { status?: number; text?: string } = {}): Answer => ({
  kind: ANSWER_KINDS.reply,
  status,
  text,
})

/** A `ServerFetch` that records what it was sent and answers from `answer`, holding a reply until it is released. */
const fakeFetch = ({ answer = () => reply() }: { answer?: (sent: Sent) => Answer } = {}) => {
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
  const release = ({ index }: { index: number }): void => {
    const resolve = held.at(index) ?? (() => undefined)
    resolve()
  }
  const releaseAll = (): void => {
    held.forEach((resolve) => resolve())
  }
  return { fetch, sent, release, releaseAll }
}

const setup = ({
  answer,
  servers = [SERVER, OTHER],
  isWarnBroken = false,
  bearer = NO_BEARER,
  reportAs,
}: {
  answer?: (sent: Sent) => Answer
  servers?: readonly ServerEntry[]
  isWarnBroken?: boolean
  bearer?: Bearer
  reportAs?: TitleSittings['reportAs']
} = {}) => {
  const fake = fakeFetch({ answer })
  const warnings: string[] = []
  const fetchedFor: string[] = []
  const calls = createServerCalls({
    serverOf: (serverId) => servers.find((server) => server.id === serverId) ?? null,
    fetchFor: (serverId) => {
      fetchedFor.push(serverId)
      return fake.fetch
    },
    ...bearer,
    reportAs,
    warn: (message) => {
      warnings.push(message)
      if (isWarnBroken) throw new Error('the log is gone')
    },
  })
  return { ...fake, calls, warnings, fetchedFor }
}

const flush = (): Promise<void> => new Promise((resolve) => setImmediate(resolve))

describe('SERVER_GONE', () => {
  it("is main's one message for a server it no longer keeps, written out here", () => {
    expect(SERVER_GONE).toBe('That server is no longer in raven player.')
    expect(CALL_MESSAGES.unknownServer).toBe(SERVER_GONE)
    expect(SOURCE_MESSAGES.unknownServer).toBe(SERVER_GONE)
    expect(PLAYER_MESSAGES.serverGone).toBe(SERVER_GONE)
  })
})

describe('the call values', () => {
  it('has the timeout, the reply cap, the in-flight cap and the messages', () => {
    expect(CALL_TIMEOUT_MS).toBe(10_000)
    expect(MAX_REPLY_CHARS).toBe(1_048_576)
    expect(MAX_SAGAS_REPLY_CHARS).toBe(8 * 1_048_576)
    expect(MAX_IN_FLIGHT).toBe(6)
    expect(WRITE_RESERVE).toBe(2)
    expect(CALL_MESSAGES.unknownServer).toBe('That server is no longer in raven player.')
    expect(CALL_MESSAGES.offList).toBe('raven player does not make that call.')
    expect(CALL_MESSAGES.adminWithAccounts('raven.example')).toBe(
      'raven.example uses accounts, so raven player does not use its admin password.',
    )
    expect(CALL_MESSAGES.unreachable('raven.example')).toBe(
      'raven player could not reach raven.example.',
    )
    expect(CALL_MESSAGES.tooBig('raven.example')).toBe(
      'raven.example sent more than raven player reads.',
    )
    expect(CALL_MESSAGES.busy('raven.example')).toBe(
      'raven player is still waiting on raven.example.',
    )
    expect(CALL_MESSAGES.otherAccount('raven.example')).toBe(
      'raven player is signed in to raven.example as someone else now.',
    )
  })
})

describe('fetchThrough', () => {
  it('never follows a redirect, times out, sends the session cookies and passes the request on', async () => {
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
    expect(init.credentials).toBe('include')
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
    const { calls, sent, fetchedFor } = setup({
      answer: () => reply({ text: '{"id":7}' }),
    })
    const result = await calls.call({
      serverId: SERVER.id,
      call: { name: CALL_NAMES.getMedia, mediaId: 7 },
    })
    expect(result).toEqual({ ok: true, status: 200, body: '{"id":7}' })
    expect(fetchedFor).toEqual([SERVER.id])
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

  it('fetches a media ticket from the stored origin with JSON accepted and no body', async () => {
    const { calls, sent } = setup({ answer: () => reply({ text: '{"ticket":"t"}' }) })
    const result = await calls.call({
      serverId: SERVER.id,
      call: { name: CALL_NAMES.getMediaTicket, mediaId: 7 },
    })
    expect(result).toEqual({ ok: true, status: 200, body: '{"ticket":"t"}' })
    expect(sent).toEqual([
      {
        url: 'https://raven.example/api/media/7/ticket',
        method: SERVER_METHODS.get,
        headers: { accept: 'application/json' },
        body: null,
        timeoutMs: CALL_TIMEOUT_MS,
      },
    ])
  })

  it('sends a content type and the rebuilt body with a saveProgress', async () => {
    const { calls, sent } = setup({ answer: () => reply({ status: 204, text: '' }) })
    const result = await calls.call({
      serverId: SERVER.id,
      call: { name: CALL_NAMES.saveProgress, mediaId: 7, position: 40 },
    })
    expect(result).toEqual({ ok: true, status: 204, body: '' })
    expect(sent).toEqual([
      {
        url: 'https://raven.example/api/media/7/progress',
        method: SERVER_METHODS.put,
        headers: { accept: 'application/json', 'content-type': 'application/json' },
        body: '{"position":40}',
        timeoutMs: CALL_TIMEOUT_MS,
      },
    ])
  })

  it('answers unknownServer for a server it does not hold, and never fetches', async () => {
    const { calls, sent, fetchedFor } = setup()
    const result = await calls.call({ serverId: 'gone', call: { name: CALL_NAMES.getLock } })
    expect(result).toEqual({ ok: false, message: CALL_MESSAGES.unknownServer })
    expect(sent).toEqual([])
    expect(fetchedFor).toEqual([])
  })

  it('answers unreachable and warns when the fetch rejects, without the secret', async () => {
    const { calls, warnings } = setup({ answer: () => ({ kind: ANSWER_KINDS.reject }) })
    const result = await calls.call({
      serverId: SERVER.id,
      call: { name: CALL_NAMES.unlock, pin: 'very-secret-pin' },
    })
    expect(result).toEqual({ ok: false, message: CALL_MESSAGES.unreachable('raven.example') })
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain('raven.example')
    expect(warnings[0]).toContain('POST /api/lock/unlock')
    expect(warnings[0]).not.toContain('very-secret-pin')
  })

  it('answers unreachable when reading the reply fails', async () => {
    const { calls, warnings } = setup({ answer: () => ({ kind: ANSWER_KINDS.failText }) })
    const result = await calls.call({ serverId: SERVER.id, call: { name: CALL_NAMES.getLock } })
    expect(result).toEqual({ ok: false, message: CALL_MESSAGES.unreachable('raven.example') })
    expect(warnings).toHaveLength(1)
  })

  it('answers unreachable when the session cannot fetch at all', async () => {
    const warnings: string[] = []
    const calls = createServerCalls({
      serverOf: () => SERVER,
      fetchFor: () => {
        throw new Error('no session')
      },
      ...NO_BEARER,
      warn: (message) => {
        warnings.push(message)
      },
    })
    const result = await calls.call({ serverId: SERVER.id, call: { name: CALL_NAMES.getLock } })
    expect(result).toEqual({ ok: false, message: CALL_MESSAGES.unreachable('raven.example') })
    expect(warnings).toHaveLength(1)
  })

  it('answers tooBig for a 2 MB reply, and passes one of exactly MAX_REPLY_CHARS', async () => {
    const big = setup({ answer: () => reply({ text: 'x'.repeat(2 * 1024 * 1024) }) })
    expect(
      await big.calls.call({ serverId: SERVER.id, call: { name: CALL_NAMES.getLock } }),
    ).toEqual({
      ok: false,
      message: CALL_MESSAGES.tooBig('raven.example'),
    })
    const edge = setup({ answer: () => reply({ text: 'x'.repeat(MAX_REPLY_CHARS) }) })
    const result = await edge.calls.call({
      serverId: SERVER.id,
      call: { name: CALL_NAMES.getLock },
    })
    expect(result.ok).toBe(true)
  })

  describe('the reply cap', () => {
    const PAST_ONE_MIB = 'x'.repeat(MAX_REPLY_CHARS * 2)

    /** Server calls over `fetchThrough`, so the cap is the one the real stream read keeps. */
    const streaming = ({ text }: { text: string }) =>
      createServerCalls({
        serverOf: () => SERVER,
        fetchFor: () => fetchThrough(() => Promise.resolve(new Response(text))),
        ...NO_BEARER,
        warn: () => undefined,
      })

    it('reads getSagas up to MAX_SAGAS_REPLY_CHARS and every other call up to MAX_REPLY_CHARS', () => {
      expect(replyCapFor({ name: CALL_NAMES.getSagas, libraryId: 3 })).toBe(MAX_SAGAS_REPLY_CHARS)
      expect(replyCapFor({ name: CALL_NAMES.getLibrary, libraryId: 3 })).toBe(MAX_REPLY_CHARS)
      expect(replyCapFor({ name: CALL_NAMES.getItem, itemId: 3 })).toBe(MAX_REPLY_CHARS)
      expect(replyCapFor({ name: CALL_NAMES.getLock })).toBe(MAX_REPLY_CHARS)
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
    const seventh = await calls.call({ serverId: SERVER.id, call: { name: CALL_NAMES.getLock } })
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
      call: { name: CALL_NAMES.saveProgress, mediaId: 1, position: 5 },
    })
    const unlock = calls.call({
      serverId: SERVER.id,
      call: { name: CALL_NAMES.unlock, pin: '1234' },
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
    const answers = await Promise.all([...reads, save, unlock])
    expect(answers.every((answer) => answer.ok)).toBe(true)
  })

  it('refuses a read once MAX_IN_FLIGHT writes are held, while a write still goes', async () => {
    const { calls, sent, releaseAll } = setup({
      answer: () => ({ kind: ANSWER_KINDS.hold, status: 204, text: '' }),
    })
    const writes = Array.from({ length: MAX_IN_FLIGHT }, (_, n) =>
      calls.call({ serverId: SERVER.id, call: { name: CALL_NAMES.recordPlay, mediaId: n + 1 } }),
    )
    expect(await calls.call({ serverId: SERVER.id, call: { name: CALL_NAMES.getLock } })).toEqual({
      ok: false,
      message: CALL_MESSAGES.busy('raven.example'),
    })
    const save = calls.call({
      serverId: SERVER.id,
      call: { name: CALL_NAMES.saveProgress, mediaId: 1, position: 5 },
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
      calls.call({ serverId: SERVER.id, call: { name: CALL_NAMES.getLock } }),
    )
    expect(await calls.call({ serverId: OTHER.id, call: { name: CALL_NAMES.getLock } })).toEqual({
      ok: true,
      status: 200,
      body: '{}',
    })
    release({ index: 0 })
    await held[0]
    const next = calls.call({ serverId: SERVER.id, call: { name: CALL_NAMES.getLock } })
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
        calls.call({ serverId: SERVER.id, call: { name: CALL_NAMES.getLock } }),
      ),
    )
    await calls.call({ serverId: SERVER.id, call: { name: CALL_NAMES.getLock } })
    expect(sent).toHaveLength(MAX_IN_FLIGHT + 1)
  })
})

describe('createServerCalls with accounts', () => {
  const ACCOUNT_A = '30000000-0000-4000-8000-00000000000a'
  const ACCOUNT_B = '30000000-0000-4000-8000-00000000000b'
  const TOKEN = 'access-token-one'
  const FRESH = 'access-token-two'
  const SIGNED_OUT = JSON.stringify({ reason: AUTH_REFUSALS.signedOut, message: 'Sign in.' })
  const PENDING = JSON.stringify({ reason: AUTH_REFUSALS.pending, message: 'Waiting.' })
  const UNAVAILABLE = JSON.stringify({ reason: AUTH_REFUSALS.unavailable, message: 'Down.' })
  const GET_LOCK = { name: CALL_NAMES.getLock } as const

  type Refusal = Parameters<Bearer['onRefusal']>[0]

  /** A bearer that hands out `tokens` in order to `authorize` and `refreshes` to `refresh`. */
  const bearerOf = ({
    tokens,
    refreshes = [],
  }: {
    tokens: readonly (string | null)[]
    refreshes?: readonly (string | null)[]
  }) => {
    const authorized: string[] = []
    const refreshed: string[] = []
    const refusals: Refusal[] = []
    const queue = { tokens: [...tokens], refreshes: [...refreshes] }
    const bearer: Bearer = {
      authorize: async ({ serverId }) => {
        authorized.push(serverId)
        return queue.tokens.shift() ?? null
      },
      refresh: async ({ serverId }) => {
        refreshed.push(serverId)
        return queue.refreshes.shift() ?? null
      },
      onRefusal: (refusal) => {
        refusals.push(refusal)
      },
      hasAccounts: () => false,
    }
    return { bearer, authorized, refreshed, refusals }
  }

  const authorizationOf = (sent: Sent): string | undefined =>
    sent.headers[AUTH_HEADERS.authorization]

  it('sends no header when there is no token, as for a server whose accounts are not ready', async () => {
    const { bearer, authorized } = bearerOf({ tokens: [null] })
    const { calls, sent } = setup({ bearer })
    await calls.call({ serverId: SERVER.id, call: GET_LOCK })
    expect(authorized).toEqual([SERVER.id])
    expect(sent.map(authorizationOf)).toEqual([undefined])
    expect(Object.keys(sent[0]?.headers ?? {})).toEqual([HTTP_HEADERS.accept])
  })

  it('sends Authorization: Bearer <token> on every call to a server with one', async () => {
    const { bearer } = bearerOf({ tokens: [TOKEN, TOKEN] })
    const { calls, sent } = setup({ bearer })
    await calls.call({ serverId: SERVER.id, call: GET_LOCK })
    await calls.call({
      serverId: SERVER.id,
      call: { name: CALL_NAMES.saveProgress, mediaId: 7, position: 3 },
    })
    expect(sent.map(authorizationOf)).toEqual([
      `${AUTH_SCHEME} ${TOKEN}`,
      `${AUTH_SCHEME} ${TOKEN}`,
    ])
  })

  it('holds no slot while the Bearer waits on Auth, so a slow sign-in never makes the server busy', async () => {
    const auth = Promise.withResolvers<string | null>()
    const asked = { count: 0 }
    // The first MAX_IN_FLIGHT calls wait on a slow Auth; the next has its token at once.
    const bearer: Bearer = {
      ...NO_BEARER,
      authorize: () => {
        asked.count += 1
        return asked.count <= MAX_IN_FLIGHT ? auth.promise : Promise.resolve(TOKEN)
      },
    }
    const { calls, sent } = setup({ bearer })
    const waiting = Array.from({ length: MAX_IN_FLIGHT }, (_, n) =>
      calls.call({ serverId: SERVER.id, call: { name: CALL_NAMES.getMedia, mediaId: n + 1 } }),
    )
    await flush()
    expect(sent).toEqual([])
    expect((await calls.call({ serverId: SERVER.id, call: GET_LOCK })).ok).toBe(true)
    auth.resolve(TOKEN)
    const answers = await Promise.all(waiting)
    expect(answers.every((answer) => answer.ok)).toBe(true)
    expect(sent).toHaveLength(MAX_IN_FLIGHT + 1)
  })

  it('sends a call made for an account only under a token issued to that account', async () => {
    const asA = tokenFor({ accountId: ACCOUNT_A })
    const asB = tokenFor({ accountId: ACCOUNT_B })
    const { bearer } = bearerOf({ tokens: [asA, asB, null] })
    const { calls, sent } = setup({ bearer })
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

  it('does not repeat a call made for an account under a refreshed token of another', async () => {
    const { bearer } = bearerOf({
      tokens: [tokenFor({ accountId: ACCOUNT_A })],
      refreshes: [tokenFor({ accountId: ACCOUNT_B })],
    })
    const { calls, sent } = setup({
      bearer,
      answer: () => reply({ status: 401, text: SIGNED_OUT }),
    })
    const result = await calls.call({
      serverId: SERVER.id,
      call: { name: CALL_NAMES.recordPlay, mediaId: 7 },
      accountId: ACCOUNT_A,
    })
    expect(result).toEqual({ ok: false, message: CALL_MESSAGES.otherAccount(SERVER.name) })
    expect(sent).toHaveLength(1)
  })

  it('does not ask for a token for a server it does not hold', async () => {
    const { bearer, authorized } = bearerOf({ tokens: [TOKEN] })
    const { calls, sent } = setup({ bearer })
    await calls.call({ serverId: '00000000-0000-4000-8000-0000000000ff', call: GET_LOCK })
    expect(authorized).toEqual([])
    expect(sent).toEqual([])
  })

  it('sends the call without a header when asking for the token fails', async () => {
    const { calls, sent } = setup({
      bearer: {
        ...NO_BEARER,
        authorize: () => Promise.reject(new Error('the keychain is locked')),
      },
    })
    const result = await calls.call({ serverId: SERVER.id, call: GET_LOCK })
    expect(result.ok).toBe(true)
    expect(sent.map(authorizationOf)).toEqual([undefined])
  })

  it('refreshes once on a signed_out 401 and repeats the call once with the new token', async () => {
    const { bearer, refreshed, refusals } = bearerOf({ tokens: [TOKEN], refreshes: [FRESH] })
    const { calls, sent } = setup({
      bearer,
      answer: (request) =>
        authorizationOf(request) === `${AUTH_SCHEME} ${FRESH}`
          ? reply({ text: '{"ok":true}' })
          : reply({ status: 401, text: SIGNED_OUT }),
    })
    const result = await calls.call({ serverId: SERVER.id, call: GET_LOCK })
    expect(result).toEqual({ ok: true, status: 200, body: '{"ok":true}' })
    expect(refreshed).toEqual([SERVER.id])
    expect(sent.map(authorizationOf)).toEqual([
      `${AUTH_SCHEME} ${TOKEN}`,
      `${AUTH_SCHEME} ${FRESH}`,
    ])
    expect(sent.map((request) => request.url)).toEqual([
      'https://raven.example/api/lock',
      'https://raven.example/api/lock',
    ])
    expect(refusals).toEqual([])
  })

  it('repeats a write with the same body', async () => {
    const { bearer } = bearerOf({ tokens: [TOKEN], refreshes: [FRESH] })
    const { calls, sent } = setup({
      bearer,
      answer: (request) =>
        authorizationOf(request) === `${AUTH_SCHEME} ${FRESH}`
          ? reply()
          : reply({ status: 401, text: SIGNED_OUT }),
    })
    await calls.call({
      serverId: SERVER.id,
      call: { name: CALL_NAMES.saveProgress, mediaId: 7, position: 3 },
    })
    expect(sent.map((request) => request.body)).toEqual(['{"position":3}', '{"position":3}'])
  })

  it('gives up on a second 401 without refreshing again, and says the session was rejected', async () => {
    const { bearer, refreshed, refusals } = bearerOf({
      tokens: [TOKEN],
      refreshes: [FRESH, 'never-used'],
    })
    const { calls, sent } = setup({
      bearer,
      answer: () => reply({ status: 401, text: SIGNED_OUT }),
    })
    const result = await calls.call({ serverId: SERVER.id, call: GET_LOCK })
    expect(result).toEqual({ ok: true, status: 401, body: SIGNED_OUT })
    expect(sent).toHaveLength(2)
    expect(refreshed).toEqual([SERVER.id])
    expect(refusals).toEqual([{ serverId: SERVER.id, isSessionRejected: true }])
  })

  it('answers the 401 as it came when the refresh yields no token, and does not repeat', async () => {
    const { bearer, refreshed, refusals } = bearerOf({ tokens: [TOKEN], refreshes: [null] })
    const { calls, sent } = setup({
      bearer,
      answer: () => reply({ status: 401, text: SIGNED_OUT }),
    })
    const result = await calls.call({ serverId: SERVER.id, call: GET_LOCK })
    expect(result).toEqual({ ok: true, status: 401, body: SIGNED_OUT })
    expect(sent).toHaveLength(1)
    expect(refreshed).toEqual([SERVER.id])
    expect(refusals).toEqual([{ serverId: SERVER.id, isSessionRejected: false }])
  })

  it('treats a refresh that throws as no token', async () => {
    const { calls, sent } = setup({
      bearer: {
        ...NO_BEARER,
        authorize: async () => TOKEN,
        refresh: () => Promise.reject(new Error('auth is down')),
      },
      answer: () => reply({ status: 401, text: SIGNED_OUT }),
    })
    const result = await calls.call({ serverId: SERVER.id, call: GET_LOCK })
    expect(result).toEqual({ ok: true, status: 401, body: SIGNED_OUT })
    expect(sent).toHaveLength(1)
  })

  it('does not refresh for a 401 that is not a signed_out refusal, such as a wrong PIN', async () => {
    const { bearer, refreshed, refusals } = bearerOf({ tokens: [TOKEN, TOKEN, TOKEN] })
    const wrongPin = setup({
      bearer,
      answer: () => reply({ status: 401, text: '{"error":"wrong"}' }),
    })
    await wrongPin.calls.call({ serverId: SERVER.id, call: GET_LOCK })
    const notJson = setup({ bearer, answer: () => reply({ status: 401, text: 'nope' }) })
    await notJson.calls.call({ serverId: SERVER.id, call: GET_LOCK })
    const pending = setup({ bearer, answer: () => reply({ status: 401, text: PENDING }) })
    await pending.calls.call({ serverId: SERVER.id, call: GET_LOCK })
    expect(refreshed).toEqual([])
    expect(wrongPin.sent).toHaveLength(1)
    expect(notJson.sent).toHaveLength(1)
    expect(pending.sent).toHaveLength(1)
    expect(refusals).toEqual([{ serverId: SERVER.id, isSessionRejected: false }])
  })

  it('does not refresh when no token was sent, but still tells onRefusal', async () => {
    const { bearer, refreshed, refusals } = bearerOf({ tokens: [null] })
    const { calls, sent } = setup({
      bearer,
      answer: () => reply({ status: 401, text: SIGNED_OUT }),
    })
    await calls.call({ serverId: SERVER.id, call: GET_LOCK })
    expect(refreshed).toEqual([])
    expect(sent).toHaveLength(1)
    expect(refusals).toEqual([{ serverId: SERVER.id, isSessionRejected: false }])
  })

  it('tells onRefusal about a 503 unavailable refusal, and answers it as it came', async () => {
    const { bearer, refreshed, refusals } = bearerOf({ tokens: [TOKEN] })
    const { calls } = setup({
      bearer,
      answer: () => reply({ status: 503, text: UNAVAILABLE }),
    })
    const result = await calls.call({ serverId: SERVER.id, call: GET_LOCK })
    expect(result).toEqual({ ok: true, status: 503, body: UNAVAILABLE })
    expect(refreshed).toEqual([])
    expect(refusals).toEqual([{ serverId: SERVER.id, isSessionRejected: false }])
  })

  it('never tells onRefusal about a success or a 503 that is not a refusal', async () => {
    const { bearer, refusals } = bearerOf({ tokens: [TOKEN, TOKEN] })
    const ok = setup({ bearer })
    await ok.calls.call({ serverId: SERVER.id, call: GET_LOCK })
    const bare = setup({ bearer, answer: () => reply({ status: 503, text: 'bad gateway' }) })
    await bare.calls.call({ serverId: SERVER.id, call: GET_LOCK })
    expect(refusals).toEqual([])
  })

  it('still answers when onRefusal throws', async () => {
    const { calls } = setup({
      bearer: {
        ...NO_BEARER,
        onRefusal: () => {
          throw new Error('the page is gone')
        },
      },
      answer: () => reply({ status: 503, text: UNAVAILABLE }),
    })
    const result = await calls.call({ serverId: SERVER.id, call: GET_LOCK })
    expect(result).toEqual({ ok: true, status: 503, body: UNAVAILABLE })
  })

  it('keeps its slot while the repeat is out, and frees it after', async () => {
    const { bearer } = bearerOf({
      tokens: Array.from({ length: MAX_IN_FLIGHT }, () => TOKEN),
      refreshes: [FRESH],
    })
    const { calls, sent, releaseAll } = setup({
      bearer,
      answer: (request) => {
        if (request.url.includes(`${API_PATHS.media}/`)) {
          return { kind: ANSWER_KINDS.hold, status: 200, text: '{}' }
        }
        return authorizationOf(request) === `${AUTH_SCHEME} ${FRESH}`
          ? { kind: ANSWER_KINDS.hold, status: 200, text: '{}' }
          : reply({ status: 401, text: SIGNED_OUT })
      },
    })
    const held = Array.from({ length: MAX_IN_FLIGHT - 1 }, (_, n) =>
      calls.call({ serverId: SERVER.id, call: { name: CALL_NAMES.getMedia, mediaId: n + 1 } }),
    )
    const repeated = calls.call({ serverId: SERVER.id, call: GET_LOCK })
    await flush()
    expect(sent).toHaveLength(MAX_IN_FLIGHT + 1)
    expect(await calls.call({ serverId: SERVER.id, call: GET_LOCK })).toEqual({
      ok: false,
      message: CALL_MESSAGES.busy('raven.example'),
    })
    releaseAll()
    expect((await repeated).ok).toBe(true)
    await Promise.all(held)
    expect((await calls.call({ serverId: SERVER.id, call: GET_LOCK })).ok).toBe(true)
  })

  it('never puts a token in a warning', async () => {
    const { warnings, calls } = setup({
      bearer: { ...NO_BEARER, authorize: async () => TOKEN },
      answer: () => ({ kind: ANSWER_KINDS.reject }),
    })
    await calls.call({ serverId: SERVER.id, call: GET_LOCK })
    expect(warnings.join('\n')).not.toContain(TOKEN)
  })

  it('goes through callFromPage the same way', async () => {
    const { bearer } = bearerOf({ tokens: [TOKEN] })
    const { calls, sent } = setup({ bearer })
    await calls.callFromPage({
      serverId: SERVER.id,
      method: SERVER_METHODS.get,
      path: API_PATHS.lock,
      body: null,
    })
    expect(sent.map(authorizationOf)).toEqual([`${AUTH_SCHEME} ${TOKEN}`])
  })

  describe('a server title left open while another account signs in', () => {
    const TITLE = { serverId: SERVER.id, mediaId: 7 }
    const SAVE = requestFor({ name: CALL_NAMES.saveProgress, mediaId: 7, position: 40 })
    const PLAY = requestFor({ name: CALL_NAMES.recordPlay, mediaId: 7 })
    const READ = requestFor({ name: CALL_NAMES.getMedia, mediaId: 7 })
    const fromPage = (request: typeof SAVE) => ({ serverId: SERVER.id, ...request })

    const signedInAs = (accountId: string | null) => {
      const signedIn = { accountId }
      const sittings = createTitleSittings({ accountIdOf: () => signedIn.accountId })
      return { signedIn, sittings }
    }

    it("sends the page's reports of a title only as the account that opened it", async () => {
      const asA = tokenFor({ accountId: ACCOUNT_A })
      const asB = tokenFor({ accountId: ACCOUNT_B })
      const { bearer } = bearerOf({ tokens: [asA, asB, asB, asB, asB] })
      const { signedIn, sittings } = signedInAs(ACCOUNT_A)
      const { calls, sent } = setup({ bearer, reportAs: sittings.reportAs })
      sittings.opened(TITLE)
      expect((await calls.callFromPage(fromPage(SAVE))).ok).toBe(true)

      signedIn.accountId = ACCOUNT_B
      const refused: ServerCallResult = {
        ok: false,
        message: CALL_MESSAGES.otherAccount(SERVER.name),
      }
      expect(await calls.callFromPage(fromPage(SAVE))).toEqual(refused)
      expect(await calls.callFromPage(fromPage(PLAY))).toEqual(refused)
      expect((await calls.callFromPage(fromPage(READ))).ok).toBe(true)
      expect(sent.map(({ url, headers }) => [url, headers[AUTH_HEADERS.authorization]])).toEqual([
        [`${SERVER.origin}${SAVE.path}`, `${AUTH_SCHEME} ${asA}`],
        [`${SERVER.origin}${READ.path}`, `${AUTH_SCHEME} ${asB}`],
      ])

      sittings.left(TITLE)
      sittings.opened(TITLE)
      expect((await calls.callFromPage(fromPage(SAVE))).ok).toBe(true)
      expect(sent.map(authorizationOf).at(-1)).toBe(`${AUTH_SCHEME} ${asB}`)
    })

    it("keeps a title the page reloads as the account that opened it, so A's reports never reach B", async () => {
      const asA = tokenFor({ accountId: ACCOUNT_A })
      const asB = tokenFor({ accountId: ACCOUNT_B })
      const { bearer } = bearerOf({ tokens: [asB, asB, asB, asA] })
      const { signedIn, sittings } = signedInAs(ACCOUNT_A)
      const { calls, sent } = setup({ bearer, reportAs: sittings.reportAs })
      sittings.opened(TITLE)
      signedIn.accountId = ACCOUNT_B
      sittings.opened(TITLE)
      const refused: ServerCallResult = {
        ok: false,
        message: CALL_MESSAGES.otherAccount(SERVER.name),
      }
      expect(await calls.callFromPage(fromPage(SAVE))).toEqual(refused)
      expect(await calls.callFromPage(fromPage(PLAY))).toEqual(refused)
      sittings.opened(TITLE)
      expect(await calls.callFromPage(fromPage(SAVE))).toEqual(refused)
      expect(sent).toEqual([])

      signedIn.accountId = ACCOUNT_A
      expect((await calls.callFromPage(fromPage(SAVE))).ok).toBe(true)
      expect(sent.map(authorizationOf)).toEqual([`${AUTH_SCHEME} ${asA}`])
    })

    it('sends nothing of a title opened signed out once an account signs in', async () => {
      const { bearer, authorized } = bearerOf({ tokens: [tokenFor({ accountId: ACCOUNT_A })] })
      const { signedIn, sittings } = signedInAs(null)
      const { calls, sent } = setup({ bearer, reportAs: sittings.reportAs })
      sittings.opened(TITLE)
      signedIn.accountId = ACCOUNT_A
      expect(await calls.callFromPage(fromPage(SAVE))).toEqual({
        ok: false,
        message: CALL_MESSAGES.otherAccount(SERVER.name),
      })
      expect(authorized).toEqual([])
      expect(sent).toEqual([])
    })
  })
})

describe('createServerCalls with accounts ready and the admin password', () => {
  const PASSWORD = 'hunter2-admin-secret'
  const ADMIN_CALLS: AllowedCall[] = [
    { name: CALL_NAMES.getAdminLock },
    { name: CALL_NAMES.unlockAdmin, password: PASSWORD },
  ]
  const readyOnly = ({ readyServerId }: { readyServerId: string }): Bearer => ({
    ...NO_BEARER,
    hasAccounts: ({ serverId }) => serverId === readyServerId,
  })

  it.each(ADMIN_CALLS)(
    'refuses $name for a ready server before any request is made',
    async (call) => {
      const { calls, sent, fetchedFor, warnings } = setup({
        bearer: readyOnly({ readyServerId: SERVER.id }),
      })
      expect(await calls.call({ serverId: SERVER.id, call })).toEqual({
        ok: false,
        message: CALL_MESSAGES.adminWithAccounts('raven.example'),
      })
      expect(sent).toEqual([])
      expect(fetchedFor).toEqual([])
      expect(warnings).toHaveLength(1)
      expect(warnings[0]).toContain(call.name)
      expect(warnings[0]).toContain('raven.example')
    },
  )

  it('refuses the page the same way, and never logs the password', async () => {
    const { calls, sent, warnings } = setup({ bearer: readyOnly({ readyServerId: SERVER.id }) })
    expect(
      await calls.callFromPage({
        serverId: SERVER.id,
        method: SERVER_METHODS.post,
        path: API_PATHS.adminUnlock,
        body: JSON.stringify({ password: PASSWORD }),
      }),
    ).toEqual({ ok: false, message: CALL_MESSAGES.adminWithAccounts('raven.example') })
    expect(
      await calls.callFromPage({
        serverId: SERVER.id,
        method: SERVER_METHODS.get,
        path: API_PATHS.admin,
        body: null,
      }),
    ).toEqual({ ok: false, message: CALL_MESSAGES.adminWithAccounts('raven.example') })
    expect(sent).toEqual([])
    expect(warnings.join('\n')).not.toContain(PASSWORD)
  })

  it.each(ADMIN_CALLS)(
    'still sends $name to a server whose accounts are not ready',
    async (call) => {
      const { calls, sent, warnings } = setup({ bearer: readyOnly({ readyServerId: OTHER.id }) })
      expect((await calls.call({ serverId: SERVER.id, call })).ok).toBe(true)
      expect(sent.map((each) => each.url.startsWith(SERVER.origin))).toEqual([true])
      expect(warnings).toEqual([])
    },
  )

  it('still sends every other call to a ready server', async () => {
    const { calls, sent } = setup({ bearer: readyOnly({ readyServerId: SERVER.id }) })
    await calls.call({ serverId: SERVER.id, call: { name: CALL_NAMES.getLock } })
    await calls.call({ serverId: SERVER.id, call: { name: CALL_NAMES.unlock, pin: '1234' } })
    expect(sent).toHaveLength(2)
  })

  it('asks which server it is about only by id, never reading the network', async () => {
    const asked: string[] = []
    const { calls } = setup({
      bearer: {
        ...NO_BEARER,
        hasAccounts: ({ serverId }) => {
          asked.push(serverId)
          return false
        },
      },
    })
    await calls.call({ serverId: SERVER.id, call: { name: CALL_NAMES.getAdminLock } })
    expect(asked).toEqual([SERVER.id])
  })
})

describe('createServerCalls.call refuses a call that slipped past the types', () => {
  // A guard that passes any value, so a test can hand over what a compromised caller
  // would without a cast: the calls must refuse it on their own.
  const passesAnything = (value: unknown): value is AllowedCall => value !== undefined
  const forge = ({ fields }: { fields: Record<string, unknown> }): AllowedCall => {
    if (!passesAnything(fields)) throw new Error('a forged call needs fields')
    return fields
  }

  const refused = async ({ forged }: { forged: AllowedCall }): Promise<void> => {
    const { calls, sent, fetchedFor, warnings } = setup()
    expect(await calls.call({ serverId: SERVER.id, call: forged })).toEqual({
      ok: false,
      message: CALL_MESSAGES.offList,
    })
    expect(sent).toEqual([])
    expect(fetchedFor).toEqual([])
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
    await refused({ forged: { name: CALL_NAMES.saveProgress, mediaId: 1, position: Number.NaN } })
    await refused({ forged: { name: CALL_NAMES.saveProgress, mediaId: 1, position: -1 } })
  })

  it('refuses a secret past MAX_SECRET', async () => {
    await refused({ forged: { name: CALL_NAMES.unlock, pin: 'a'.repeat(300) } })
  })

  it('refuses a call name it does not know', async () => {
    await refused({ forged: forge({ fields: { name: 'deleteLibrary', mediaId: 1 } }) })
  })
})

describe('createServerCalls log lines', () => {
  const HIDDEN = '\u202e\u200b\u2028\u2029\ufeff\r\n'

  it('escapes bidi overrides, zero widths and separators in a refused path', async () => {
    const { calls, warnings } = setup()
    await calls.callFromPage({
      serverId: SERVER.id,
      method: SERVER_METHODS.get,
      path: `/api/lock${HIDDEN}`,
      body: null,
    })
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).not.toMatch(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u)
    expect(warnings[0]).toContain('\\u{202e}')
  })

  it('escapes the server name it logs', async () => {
    const odd: ServerEntry = { ...SERVER, name: `raven${HIDDEN}FORGED` }
    const { calls, warnings } = setup({
      servers: [odd],
      answer: () => ({ kind: ANSWER_KINDS.reject }),
    })
    await calls.call({ serverId: odd.id, call: { name: CALL_NAMES.getLock } })
    const big = setup({
      servers: [odd],
      answer: () => reply({ text: 'x'.repeat(MAX_REPLY_CHARS + 1) }),
    })
    await big.calls.call({ serverId: odd.id, call: { name: CALL_NAMES.getLock } })
    const lines = [...warnings, ...big.warnings]
    expect(lines).toHaveLength(2)
    expect(lines.every((line) => !/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(line))).toBe(true)
  })

  it('answers every call when the log throws', async () => {
    const down = setup({ answer: () => ({ kind: ANSWER_KINDS.reject }), isWarnBroken: true })
    expect(
      await down.calls.call({ serverId: SERVER.id, call: { name: CALL_NAMES.getLock } }),
    ).toEqual({
      ok: false,
      message: CALL_MESSAGES.unreachable('raven.example'),
    })
    const save = down.calls.call({
      serverId: SERVER.id,
      call: { name: CALL_NAMES.saveProgress, mediaId: 1, position: 5 },
    })
    await down.calls.settleWrites()
    expect(await save).toEqual({ ok: false, message: CALL_MESSAGES.unreachable('raven.example') })
    expect(down.calls.hasPendingWrites()).toBe(false)
    expect(
      await down.calls.callFromPage({
        serverId: SERVER.id,
        method: SERVER_METHODS.get,
        path: '/api/libraries',
        body: null,
      }),
    ).toEqual({ ok: false, message: CALL_MESSAGES.offList })
    const big = setup({
      answer: () => reply({ text: 'x'.repeat(MAX_REPLY_CHARS + 1) }),
      isWarnBroken: true,
    })
    expect(
      await big.calls.call({ serverId: SERVER.id, call: { name: CALL_NAMES.getLock } }),
    ).toEqual({
      ok: false,
      message: CALL_MESSAGES.tooBig('raven.example'),
    })
    expect(down.warnings.length).toBeGreaterThan(0)
  })
})

describe('createServerCalls.callFromPage', () => {
  it('refuses a call off the list, fetches nothing and warns with the method and path', async () => {
    const { calls, sent, fetchedFor, warnings } = setup()
    const result = await calls.callFromPage({
      serverId: SERVER.id,
      method: SERVER_METHODS.get,
      path: '/api/media/1/location',
      body: null,
    })
    expect(result).toEqual({ ok: false, message: CALL_MESSAGES.offList })
    expect(sent).toEqual([])
    expect(fetchedFor).toEqual([])
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain('GET /api/media/1/location')
  })

  it('never logs the body of a refused call', async () => {
    const { calls, warnings } = setup()
    const pin = 'p'.repeat(300)
    await calls.callFromPage({
      serverId: SERVER.id,
      method: SERVER_METHODS.post,
      path: '/api/lock/unlock',
      body: JSON.stringify({ pin }),
    })
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).not.toContain('ppp')
  })

  it('keeps a refused path from breaking or flooding the log line', async () => {
    const { calls, warnings } = setup()
    await calls.callFromPage({
      serverId: SERVER.id,
      method: 'GET\n',
      path: `/api/lock\r\nFORGED LINE\u0000${'z'.repeat(5000)}`,
      body: null,
    })
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).not.toMatch(/\p{Cc}/u)
    expect(warnings[0]?.length ?? 0).toBeLessThan(600)
  })

  it('refuses an absolute URL as the path and never reaches its host', async () => {
    const { calls, sent } = setup()
    const result = await calls.callFromPage({
      serverId: SERVER.id,
      method: SERVER_METHODS.get,
      path: 'https://evil.example/api/lock',
      body: null,
    })
    expect(result).toEqual({ ok: false, message: CALL_MESSAGES.offList })
    expect(sent).toEqual([])
  })

  it('runs an allowed call against the stored origin with the rebuilt body', async () => {
    const { calls, sent } = setup({ answer: () => reply({ text: LOCK_STATE }) })
    const result = await calls.callFromPage({
      serverId: SERVER.id,
      method: SERVER_METHODS.post,
      path: '/api/lock/unlock',
      body: '{"pin":"1234","extra":true}',
    })
    expect(result).toEqual({ ok: true, status: 200, body: LOCK_STATE })
    expect(sent).toEqual([
      {
        url: 'https://raven.example/api/lock/unlock',
        method: SERVER_METHODS.post,
        headers: { accept: 'application/json', 'content-type': 'application/json' },
        body: '{"pin":"1234"}',
        timeoutMs: CALL_TIMEOUT_MS,
      },
    ])
  })

  it('answers unknownServer for an allowed call to a server it does not hold', async () => {
    const { calls, sent } = setup()
    expect(
      await calls.callFromPage({
        serverId: 'gone',
        method: SERVER_METHODS.get,
        path: API_PATHS.lock,
        body: null,
      }),
    ).toEqual({ ok: false, message: CALL_MESSAGES.unknownServer })
    expect(sent).toEqual([])
  })

  it.each(['/api/media-origins', '/api/media/7/ticket'])(
    'refuses GET %s, which only main makes, fetches nothing and warns',
    async (path) => {
      const { calls, sent, fetchedFor, warnings } = setup({
        answer: () => reply({ text: '{"ticket":"t"}' }),
      })
      const result = await calls.callFromPage({
        serverId: SERVER.id,
        method: SERVER_METHODS.get,
        path,
        body: null,
      })
      expect(result).toEqual({ ok: false, message: CALL_MESSAGES.offList })
      expect(sent).toEqual([])
      expect(fetchedFor).toEqual([])
      expect(warnings).toEqual([`refused a page call off the allowlist: GET ${path}`])
    },
  )

  it("still runs main's own origin list and ticket reads", async () => {
    const { calls, sent } = setup({ answer: () => reply({ text: '{"ticket":"t"}' }) })
    expect(
      await calls.call({
        serverId: SERVER.id,
        call: { name: CALL_NAMES.getMediaTicket, mediaId: 7 },
      }),
    ).toEqual({ ok: true, status: 200, body: '{"ticket":"t"}' })
    expect(
      (await calls.call({ serverId: SERVER.id, call: { name: CALL_NAMES.getMediaOrigins } })).ok,
    ).toBe(true)
    expect(sent.map(({ url }) => url)).toEqual([
      'https://raven.example/api/media/7/ticket',
      'https://raven.example/api/media-origins',
    ])
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
      call: { name: CALL_NAMES.saveProgress, mediaId: 1, position: 5 },
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
      call: { name: CALL_NAMES.saveProgress, mediaId: 1, position: 5 },
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
      call: { name: CALL_NAMES.saveProgress, mediaId: 1, position: 5 },
    })
    await calls.settleWrites()
    expect(calls.hasPendingWrites()).toBe(false)
    expect((await save).ok).toBe(false)
  })
})

describe('probeServer', () => {
  const READY_CONFIG = {
    state: AUTH_CONFIG_STATES.ready,
    supabaseUrl: 'https://project.supabase.co',
    publishableKey: 'sb_publishable_example',
    webUrl: 'https://raven.example',
    cookieName: 'maester-auth',
  }
  const PINNED = {
    supabaseUrl: 'https://project.supabase.co',
    publishableKey: 'sb_publishable_example',
    webUrl: 'https://raven.example',
  }
  const CONFIG_URL = 'https://raven.example/api/auth/config'
  const LOCK_URL = 'https://raven.example/api/lock'

  /** Answers each URL from `answers`; a URL it was not given rejects, as an unreachable host does. */
  const byUrl = ({ answers }: { answers: Record<string, Answer> }) =>
    fakeFetch({ answer: (sent) => answers[sent.url] ?? { kind: ANSWER_KINDS.reject } })

  const probeWith = async ({ answers }: { answers: Record<string, Answer> }) => {
    const fake = byUrl({ answers })
    const result = await probeServer({ fetch: fake.fetch, origin: SERVER.origin })
    return { result, sent: fake.sent.map((sent) => sent.url) }
  }

  const config = (value: unknown): Answer => reply({ text: JSON.stringify(value) })

  it('asks GET /api/auth/config first, on the origin it is given', async () => {
    const fake = byUrl({ answers: { [CONFIG_URL]: config({ state: AUTH_CONFIG_STATES.off }) } })
    await probeServer({ fetch: fake.fetch, origin: SERVER.origin })
    expect(fake.sent).toEqual([
      {
        url: CONFIG_URL,
        method: SERVER_METHODS.get,
        headers: { accept: 'application/json' },
        body: null,
        timeoutMs: CALL_TIMEOUT_MS,
      },
    ])
  })

  it('is a raven server with no sign-in when accounts are off, and asks nothing more', async () => {
    const { result, sent } = await probeWith({
      answers: { [CONFIG_URL]: config({ state: AUTH_CONFIG_STATES.off }) },
    })
    expect(result).toEqual({ kind: PROBE_KINDS.raven, signIn: null })
    expect(sent).toEqual([CONFIG_URL])
  })

  it('is a raven server with no sign-in when accounts are unavailable', async () => {
    const { result } = await probeWith({
      answers: { [CONFIG_URL]: config({ state: AUTH_CONFIG_STATES.unavailable }) },
    })
    expect(result).toEqual({ kind: PROBE_KINDS.raven, signIn: null })
  })

  it('is a raven server with its sign-in endpoints when accounts are ready', async () => {
    const { result } = await probeWith({ answers: { [CONFIG_URL]: config(READY_CONFIG) } })
    expect(result).toEqual({ kind: PROBE_KINDS.raven, signIn: PINNED })
  })

  it('pins the endpoints as raven player reads them, not as the server wrote them', async () => {
    const { result } = await probeWith({
      answers: {
        [CONFIG_URL]: config({ ...READY_CONFIG, supabaseUrl: 'HTTPS://Project.Supabase.co/' }),
      },
    })
    expect(result).toEqual({ kind: PROBE_KINDS.raven, signIn: PINNED })
  })

  it.each([
    ['an http Supabase URL', { supabaseUrl: 'http://project.supabase.co' }],
    ['a Supabase URL with a path', { supabaseUrl: 'https://project.supabase.co/auth/v1' }],
    ['a web URL with credentials', { webUrl: 'https://user:pw@raven.example' }],
    ['a key that is not publishable', { publishableKey: 'sb_secret_example' }],
  ])('refuses a ready server with %s as a bad sign-in, without asking the lock', async (_, bad) => {
    const { result, sent } = await probeWith({
      answers: {
        [CONFIG_URL]: config({ ...READY_CONFIG, ...bad }),
        [LOCK_URL]: reply({ text: LOCK_STATE }),
      },
    })
    expect(result).toEqual({ kind: PROBE_KINDS.badSignIn })
    expect(sent).toEqual([CONFIG_URL])
  })

  it('falls back to the lock for a 404, a server older than accounts', async () => {
    const { result, sent } = await probeWith({
      answers: { [CONFIG_URL]: reply({ status: 404 }), [LOCK_URL]: reply({ text: LOCK_STATE }) },
    })
    expect(result).toEqual({ kind: PROBE_KINDS.raven, signIn: null })
    expect(sent).toEqual([CONFIG_URL, LOCK_URL])
  })

  it('asks the lock on GET with the same headers and timeout', async () => {
    const fake = byUrl({
      answers: { [CONFIG_URL]: reply({ status: 404 }), [LOCK_URL]: reply({ text: LOCK_STATE }) },
    })
    await probeServer({ fetch: fake.fetch, origin: SERVER.origin })
    expect(fake.sent[1]).toEqual({
      url: LOCK_URL,
      method: SERVER_METHODS.get,
      headers: { accept: 'application/json' },
      body: null,
      timeoutMs: CALL_TIMEOUT_MS,
    })
  })

  it('is unreachable for a 404 with no lock state behind it', async () => {
    expect(
      (
        await probeWith({
          answers: { [CONFIG_URL]: reply({ status: 404 }), [LOCK_URL]: reply({ status: 404 }) },
        })
      ).result,
    ).toEqual({ kind: PROBE_KINDS.unreachable })
    expect(
      (
        await probeWith({
          answers: { [CONFIG_URL]: reply({ status: 404 }), [LOCK_URL]: reply({ text: '<html>' }) },
        })
      ).result,
    ).toEqual({ kind: PROBE_KINDS.unreachable })
    expect((await probeWith({ answers: { [CONFIG_URL]: reply({ status: 404 }) } })).result).toEqual(
      { kind: PROBE_KINDS.unreachable },
    )
  })

  it('is unreachable for a 200 HTML page, without asking the lock', async () => {
    const { result, sent } = await probeWith({
      answers: { [CONFIG_URL]: reply({ text: '<html>' }), [LOCK_URL]: reply({ text: LOCK_STATE }) },
    })
    expect(result).toEqual({ kind: PROBE_KINDS.unreachable })
    expect(sent).toEqual([CONFIG_URL])
  })

  it.each([[{ ok: 1 }], [{ state: 'on' }], [{ state: AUTH_CONFIG_STATES.ready }], [null]])(
    'is unreachable for 200 JSON that is not an auth config: %j',
    async (value) => {
      const { result } = await probeWith({
        answers: { [CONFIG_URL]: config(value), [LOCK_URL]: reply({ text: LOCK_STATE }) },
      })
      expect(result).toEqual({ kind: PROBE_KINDS.unreachable })
    },
  )

  it.each([302, 401, 500, 503])(
    'is unreachable for a %s, without asking the lock',
    async (status) => {
      const { result, sent } = await probeWith({
        answers: {
          [CONFIG_URL]: reply({ status, text: JSON.stringify({ state: AUTH_CONFIG_STATES.off }) }),
          [LOCK_URL]: reply({ text: LOCK_STATE }),
        },
      })
      expect(result).toEqual({ kind: PROBE_KINDS.unreachable })
      expect(sent).toEqual([CONFIG_URL])
    },
  )

  it('is unreachable for a rejection or a reply that cannot be read', async () => {
    expect((await probeWith({ answers: {} })).result).toEqual({ kind: PROBE_KINDS.unreachable })
    expect(
      (await probeWith({ answers: { [CONFIG_URL]: { kind: ANSWER_KINDS.failText } } })).result,
    ).toEqual({ kind: PROBE_KINDS.unreachable })
  })

  it('is unreachable when the lock rejects after a 404', async () => {
    const { result } = await probeWith({ answers: { [CONFIG_URL]: reply({ status: 404 }) } })
    expect(result).toEqual({ kind: PROBE_KINDS.unreachable })
  })

  it('is unreachable for a reply past MAX_REPLY_CHARS', async () => {
    const padded = `${JSON.stringify({ state: AUTH_CONFIG_STATES.off })}${' '.repeat(MAX_REPLY_CHARS)}`
    const { result } = await probeWith({ answers: { [CONFIG_URL]: reply({ text: padded }) } })
    expect(result).toEqual({ kind: PROBE_KINDS.unreachable })
  })

  it('is unreachable for a lock reply past MAX_REPLY_CHARS', async () => {
    const padded = `${LOCK_STATE}${' '.repeat(MAX_REPLY_CHARS)}`
    const { result } = await probeWith({
      answers: { [CONFIG_URL]: reply({ status: 404 }), [LOCK_URL]: reply({ text: padded }) },
    })
    expect(result).toEqual({ kind: PROBE_KINDS.unreachable })
  })
})
