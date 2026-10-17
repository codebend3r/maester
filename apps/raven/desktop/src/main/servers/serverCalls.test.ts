import { describe, expect, it } from 'bun:test'
import type { ServerEntry } from '@/main/desktopConfig'
import { PLAYER_MESSAGES } from '@/main/player/playerService'
import type { AllowedCall } from '@/main/servers/allowlist'
import { SOURCE_MESSAGES } from '@/main/servers/serverSources'
import { SERVER_GONE } from '@/shared/protocol'
import {
  CALL_MESSAGES,
  CALL_TIMEOUT_MS,
  MAX_IN_FLIGHT,
  MAX_REPLY_CHARS,
  MAX_SAGAS_REPLY_CHARS,
  WRITE_RESERVE,
  createServerCalls,
  fetchThrough,
  probeServer,
  replyCapFor,
  type ServerFetch,
} from '@/main/servers/serverCalls'

type Sent = Parameters<ServerFetch>[0]
type Answer =
  | { kind: 'reply'; status: number; text: string }
  | { kind: 'hold'; status: number; text: string }
  | { kind: 'reject' }
  | { kind: 'failText' }

const SERVER: ServerEntry = {
  id: '00000000-0000-4000-8000-000000000001',
  origin: 'https://raven.example',
  name: 'raven.example',
  addedAt: 1,
}

const OTHER: ServerEntry = {
  id: '00000000-0000-4000-8000-000000000002',
  origin: 'https://other.example',
  name: 'other.example',
  addedAt: 2,
}

const LOCK_STATE = '{"available":true,"unlocked":false}'

const reply = ({ status = 200, text = '{}' }: { status?: number; text?: string } = {}): Answer => ({
  kind: 'reply',
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
      case 'reply':
        return Promise.resolve({
          status: answered.status,
          text: () => Promise.resolve(answered.text),
        })
      case 'hold':
        return new Promise((resolve) => {
          held.push(() =>
            resolve({ status: answered.status, text: () => Promise.resolve(answered.text) }),
          )
        })
      case 'reject':
        return Promise.reject(new Error('net::ERR_CONNECTION_REFUSED'))
      case 'failText':
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
}: {
  answer?: (sent: Sent) => Answer
  servers?: readonly ServerEntry[]
  isWarnBroken?: boolean
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
    expect(CALL_MESSAGES.unreachable('raven.example')).toBe(
      'raven player could not reach raven.example.',
    )
    expect(CALL_MESSAGES.tooBig('raven.example')).toBe(
      'raven.example sent more than raven player reads.',
    )
    expect(CALL_MESSAGES.busy('raven.example')).toBe(
      'raven player is still waiting on raven.example.',
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
      method: 'PUT',
      headers: { accept: 'application/json', 'content-type': 'application/json' },
      body: '{"position":40}',
      timeoutMs: 5,
    })
    expect(answer.status).toBe(201)
    expect(await answer.text({ maxChars: MAX_REPLY_CHARS })).toBe('{"a":1}')
    expect(seen).toHaveLength(1)
    const [{ url, init }] = seen
    expect(url).toBe('https://raven.example/api/media/7/progress')
    expect(init.method).toBe('PUT')
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
      method: 'GET',
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
      method: 'GET',
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
      method: 'GET',
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
      method: 'POST',
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
          method: 'GET',
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
          method: 'GET',
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
          method: 'GET',
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
    const result = await calls.call({ serverId: SERVER.id, call: { name: 'getMedia', mediaId: 7 } })
    expect(result).toEqual({ ok: true, status: 200, body: '{"id":7}' })
    expect(fetchedFor).toEqual([SERVER.id])
    expect(sent).toEqual([
      {
        url: 'https://raven.example/api/media/7',
        method: 'GET',
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
      call: { name: 'getMediaTicket', mediaId: 7 },
    })
    expect(result).toEqual({ ok: true, status: 200, body: '{"ticket":"t"}' })
    expect(sent).toEqual([
      {
        url: 'https://raven.example/api/media/7/ticket',
        method: 'GET',
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
      call: { name: 'saveProgress', mediaId: 7, position: 40 },
    })
    expect(result).toEqual({ ok: true, status: 204, body: '' })
    expect(sent).toEqual([
      {
        url: 'https://raven.example/api/media/7/progress',
        method: 'PUT',
        headers: { accept: 'application/json', 'content-type': 'application/json' },
        body: '{"position":40}',
        timeoutMs: CALL_TIMEOUT_MS,
      },
    ])
  })

  it('answers unknownServer for a server it does not hold, and never fetches', async () => {
    const { calls, sent, fetchedFor } = setup()
    const result = await calls.call({ serverId: 'gone', call: { name: 'getLock' } })
    expect(result).toEqual({ ok: false, message: CALL_MESSAGES.unknownServer })
    expect(sent).toEqual([])
    expect(fetchedFor).toEqual([])
  })

  it('answers unreachable and warns when the fetch rejects, without the secret', async () => {
    const { calls, warnings } = setup({ answer: () => ({ kind: 'reject' }) })
    const result = await calls.call({
      serverId: SERVER.id,
      call: { name: 'unlock', pin: 'very-secret-pin' },
    })
    expect(result).toEqual({ ok: false, message: CALL_MESSAGES.unreachable('raven.example') })
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain('raven.example')
    expect(warnings[0]).toContain('POST /api/lock/unlock')
    expect(warnings[0]).not.toContain('very-secret-pin')
  })

  it('answers unreachable when reading the reply fails', async () => {
    const { calls, warnings } = setup({ answer: () => ({ kind: 'failText' }) })
    const result = await calls.call({ serverId: SERVER.id, call: { name: 'getLock' } })
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
      warn: (message) => {
        warnings.push(message)
      },
    })
    const result = await calls.call({ serverId: SERVER.id, call: { name: 'getLock' } })
    expect(result).toEqual({ ok: false, message: CALL_MESSAGES.unreachable('raven.example') })
    expect(warnings).toHaveLength(1)
  })

  it('answers tooBig for a 2 MB reply, and passes one of exactly MAX_REPLY_CHARS', async () => {
    const big = setup({ answer: () => reply({ text: 'x'.repeat(2 * 1024 * 1024) }) })
    expect(await big.calls.call({ serverId: SERVER.id, call: { name: 'getLock' } })).toEqual({
      ok: false,
      message: CALL_MESSAGES.tooBig('raven.example'),
    })
    const edge = setup({ answer: () => reply({ text: 'x'.repeat(MAX_REPLY_CHARS) }) })
    const result = await edge.calls.call({ serverId: SERVER.id, call: { name: 'getLock' } })
    expect(result.ok).toBe(true)
  })

  describe('the reply cap', () => {
    const PAST_ONE_MIB = 'x'.repeat(MAX_REPLY_CHARS * 2)

    /** Server calls over `fetchThrough`, so the cap is the one the real stream read keeps. */
    const streaming = ({ text }: { text: string }) =>
      createServerCalls({
        serverOf: () => SERVER,
        fetchFor: () => fetchThrough(() => Promise.resolve(new Response(text))),
        warn: () => undefined,
      })

    it('reads getSagas up to MAX_SAGAS_REPLY_CHARS and every other call up to MAX_REPLY_CHARS', () => {
      expect(replyCapFor({ name: 'getSagas', libraryId: 3 })).toBe(MAX_SAGAS_REPLY_CHARS)
      expect(replyCapFor({ name: 'getLibrary', libraryId: 3 })).toBe(MAX_REPLY_CHARS)
      expect(replyCapFor({ name: 'getItem', itemId: 3 })).toBe(MAX_REPLY_CHARS)
      expect(replyCapFor({ name: 'getLock' })).toBe(MAX_REPLY_CHARS)
    })

    it('reads a getSagas reply past 1 MiB and under 8 MiB whole', async () => {
      const calls = streaming({ text: PAST_ONE_MIB })
      expect(
        await calls.call({ serverId: SERVER.id, call: { name: 'getSagas', libraryId: 3 } }),
      ).toEqual({ ok: true, status: 200, body: PAST_ONE_MIB })
    })

    it("still cuts another call's reply past 1 MiB", async () => {
      const calls = streaming({ text: PAST_ONE_MIB })
      expect(
        await calls.call({ serverId: SERVER.id, call: { name: 'getLibrary', libraryId: 3 } }),
      ).toEqual({ ok: false, message: CALL_MESSAGES.tooBig('raven.example') })
    })

    it('answers tooBig for a getSagas reply past MAX_SAGAS_REPLY_CHARS', async () => {
      const { calls } = setup({
        answer: () => reply({ text: 'x'.repeat(MAX_SAGAS_REPLY_CHARS + 1) }),
      })
      expect(
        await calls.call({ serverId: SERVER.id, call: { name: 'getSagas', libraryId: 3 } }),
      ).toEqual({ ok: false, message: CALL_MESSAGES.tooBig('raven.example') })
    })
  })

  it('passes an error status and its body on for the page to read', async () => {
    const { calls } = setup({ answer: () => reply({ status: 500, text: '<html>' }) })
    expect(
      await calls.call({ serverId: SERVER.id, call: { name: 'getMedia', mediaId: 1 } }),
    ).toEqual({ ok: true, status: 500, body: '<html>' })
  })

  it('passes a 423 and a 404 on as they are', async () => {
    const locked = setup({ answer: () => reply({ status: 423, text: '{"message":"Locked"}' }) })
    expect(
      await locked.calls.call({ serverId: SERVER.id, call: { name: 'getMedia', mediaId: 1 } }),
    ).toEqual({ ok: true, status: 423, body: '{"message":"Locked"}' })
    const gone = setup({ answer: () => reply({ status: 404, text: '{}' }) })
    expect(
      await gone.calls.call({ serverId: SERVER.id, call: { name: 'getMedia', mediaId: 1 } }),
    ).toEqual({ ok: true, status: 404, body: '{}' })
  })

  it('answers busy for a seventh call held at once, without fetching it', async () => {
    const { calls, sent, releaseAll } = setup({
      answer: () => ({ kind: 'hold', status: 200, text: '{}' }),
    })
    const held = Array.from({ length: MAX_IN_FLIGHT }, (_, n) =>
      calls.call({ serverId: SERVER.id, call: { name: 'getMedia', mediaId: n + 1 } }),
    )
    const seventh = await calls.call({ serverId: SERVER.id, call: { name: 'getLock' } })
    expect(seventh).toEqual({ ok: false, message: CALL_MESSAGES.busy('raven.example') })
    expect(sent).toHaveLength(MAX_IN_FLIGHT)
    releaseAll()
    const answers = await Promise.all(held)
    expect(answers.every((answer) => answer.ok)).toBe(true)
  })

  it('keeps WRITE_RESERVE slots that reads cannot take, so six held reads never starve a save', async () => {
    const { calls, sent, releaseAll } = setup({
      answer: () => ({ kind: 'hold', status: 204, text: '' }),
    })
    const reads = Array.from({ length: MAX_IN_FLIGHT }, (_, n) =>
      calls.call({ serverId: SERVER.id, call: { name: 'getMedia', mediaId: n + 1 } }),
    )
    const save = calls.call({
      serverId: SERVER.id,
      call: { name: 'saveProgress', mediaId: 1, position: 5 },
    })
    const unlock = calls.call({ serverId: SERVER.id, call: { name: 'unlock', pin: '1234' } })
    expect(sent).toHaveLength(MAX_IN_FLIGHT + WRITE_RESERVE)
    expect(sent.map((input) => input.method).slice(MAX_IN_FLIGHT)).toEqual(['PUT', 'POST'])
    expect(
      await calls.call({ serverId: SERVER.id, call: { name: 'recordPlay', mediaId: 1 } }),
    ).toEqual({ ok: false, message: CALL_MESSAGES.busy('raven.example') })
    expect(sent).toHaveLength(MAX_IN_FLIGHT + WRITE_RESERVE)
    releaseAll()
    const answers = await Promise.all([...reads, save, unlock])
    expect(answers.every((answer) => answer.ok)).toBe(true)
  })

  it('refuses a read once MAX_IN_FLIGHT writes are held, while a write still goes', async () => {
    const { calls, sent, releaseAll } = setup({
      answer: () => ({ kind: 'hold', status: 204, text: '' }),
    })
    const writes = Array.from({ length: MAX_IN_FLIGHT }, (_, n) =>
      calls.call({ serverId: SERVER.id, call: { name: 'recordPlay', mediaId: n + 1 } }),
    )
    expect(await calls.call({ serverId: SERVER.id, call: { name: 'getLock' } })).toEqual({
      ok: false,
      message: CALL_MESSAGES.busy('raven.example'),
    })
    const save = calls.call({
      serverId: SERVER.id,
      call: { name: 'saveProgress', mediaId: 1, position: 5 },
    })
    expect(sent).toHaveLength(MAX_IN_FLIGHT + 1)
    releaseAll()
    await Promise.all([...writes, save])
  })

  it('counts calls in flight per server and frees a slot once a call settles', async () => {
    const { calls, sent, release } = setup({
      answer: (input) =>
        input.url.startsWith(SERVER.origin) ? { kind: 'hold', status: 200, text: '{}' } : reply(),
    })
    const held = Array.from({ length: MAX_IN_FLIGHT }, () =>
      calls.call({ serverId: SERVER.id, call: { name: 'getLock' } }),
    )
    expect(await calls.call({ serverId: OTHER.id, call: { name: 'getLock' } })).toEqual({
      ok: true,
      status: 200,
      body: '{}',
    })
    release({ index: 0 })
    await held[0]
    const next = calls.call({ serverId: SERVER.id, call: { name: 'getLock' } })
    await flush()
    expect(sent.filter((input) => input.url.startsWith(SERVER.origin))).toHaveLength(
      MAX_IN_FLIGHT + 1,
    )
    release({ index: MAX_IN_FLIGHT })
    expect((await next).ok).toBe(true)
  })

  it('frees a slot after a call that failed', async () => {
    const { calls, sent } = setup({ answer: () => ({ kind: 'reject' }) })
    await Promise.all(
      Array.from({ length: MAX_IN_FLIGHT }, () =>
        calls.call({ serverId: SERVER.id, call: { name: 'getLock' } }),
      ),
    )
    await calls.call({ serverId: SERVER.id, call: { name: 'getLock' } })
    expect(sent).toHaveLength(MAX_IN_FLIGHT + 1)
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
    await refused({ forged: forge({ fields: { name: 'getMedia', mediaId: '1/../../admin' } }) })
  })

  it('refuses a media id that is not a whole number above 0', async () => {
    await refused({ forged: { name: 'getTracks', mediaId: 1.5 } })
    await refused({ forged: { name: 'recordPlay', mediaId: 0 } })
    await refused({ forged: { name: 'getMedia', mediaId: Number.MAX_SAFE_INTEGER + 2 } })
  })

  it('refuses a position that is not a spot in the file', async () => {
    await refused({ forged: { name: 'saveProgress', mediaId: 1, position: Number.NaN } })
    await refused({ forged: { name: 'saveProgress', mediaId: 1, position: -1 } })
  })

  it('refuses a secret past MAX_SECRET', async () => {
    await refused({ forged: { name: 'unlock', pin: 'a'.repeat(300) } })
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
      method: 'GET',
      path: `/api/lock${HIDDEN}`,
      body: null,
    })
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).not.toMatch(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u)
    expect(warnings[0]).toContain('\\u{202e}')
  })

  it('escapes the server name it logs', async () => {
    const odd: ServerEntry = { ...SERVER, name: `raven${HIDDEN}FORGED` }
    const { calls, warnings } = setup({ servers: [odd], answer: () => ({ kind: 'reject' }) })
    await calls.call({ serverId: odd.id, call: { name: 'getLock' } })
    const big = setup({
      servers: [odd],
      answer: () => reply({ text: 'x'.repeat(MAX_REPLY_CHARS + 1) }),
    })
    await big.calls.call({ serverId: odd.id, call: { name: 'getLock' } })
    const lines = [...warnings, ...big.warnings]
    expect(lines).toHaveLength(2)
    expect(lines.every((line) => !/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(line))).toBe(true)
  })

  it('answers every call when the log throws', async () => {
    const down = setup({ answer: () => ({ kind: 'reject' }), isWarnBroken: true })
    expect(await down.calls.call({ serverId: SERVER.id, call: { name: 'getLock' } })).toEqual({
      ok: false,
      message: CALL_MESSAGES.unreachable('raven.example'),
    })
    const save = down.calls.call({
      serverId: SERVER.id,
      call: { name: 'saveProgress', mediaId: 1, position: 5 },
    })
    await down.calls.settleWrites()
    expect(await save).toEqual({ ok: false, message: CALL_MESSAGES.unreachable('raven.example') })
    expect(down.calls.hasPendingWrites()).toBe(false)
    expect(
      await down.calls.callFromPage({
        serverId: SERVER.id,
        method: 'GET',
        path: '/api/libraries',
        body: null,
      }),
    ).toEqual({ ok: false, message: CALL_MESSAGES.offList })
    const big = setup({
      answer: () => reply({ text: 'x'.repeat(MAX_REPLY_CHARS + 1) }),
      isWarnBroken: true,
    })
    expect(await big.calls.call({ serverId: SERVER.id, call: { name: 'getLock' } })).toEqual({
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
      method: 'GET',
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
      method: 'POST',
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
      method: 'GET',
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
      method: 'POST',
      path: '/api/lock/unlock',
      body: '{"pin":"1234","extra":true}',
    })
    expect(result).toEqual({ ok: true, status: 200, body: LOCK_STATE })
    expect(sent).toEqual([
      {
        url: 'https://raven.example/api/lock/unlock',
        method: 'POST',
        headers: { accept: 'application/json', 'content-type': 'application/json' },
        body: '{"pin":"1234"}',
        timeoutMs: CALL_TIMEOUT_MS,
      },
    ])
  })

  it('answers unknownServer for an allowed call to a server it does not hold', async () => {
    const { calls, sent } = setup()
    expect(
      await calls.callFromPage({ serverId: 'gone', method: 'GET', path: '/api/lock', body: null }),
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
        method: 'GET',
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
      await calls.call({ serverId: SERVER.id, call: { name: 'getMediaTicket', mediaId: 7 } }),
    ).toEqual({ ok: true, status: 200, body: '{"ticket":"t"}' })
    expect((await calls.call({ serverId: SERVER.id, call: { name: 'getMediaOrigins' } })).ok).toBe(
      true,
    )
    expect(sent.map(({ url }) => url)).toEqual([
      'https://raven.example/api/media/7/ticket',
      'https://raven.example/api/media-origins',
    ])
  })
})

describe('pending writes', () => {
  it('holds settleWrites until a held saveProgress is released', async () => {
    const { calls, release } = setup({
      answer: () => ({ kind: 'hold', status: 204, text: '' }),
    })
    expect(calls.hasPendingWrites()).toBe(false)
    const save = calls.call({
      serverId: SERVER.id,
      call: { name: 'saveProgress', mediaId: 1, position: 5 },
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
      answer: () => ({ kind: 'hold', status: 200, text: '{}' }),
    })
    const read = calls.call({ serverId: SERVER.id, call: { name: 'getMedia', mediaId: 1 } })
    expect(calls.hasPendingWrites()).toBe(false)
    await calls.settleWrites()
    releaseAll()
    await read
  })

  it('counts recordPlay as a write', async () => {
    const { calls, releaseAll } = setup({
      answer: () => ({ kind: 'hold', status: 204, text: '' }),
    })
    const play = calls.call({ serverId: SERVER.id, call: { name: 'recordPlay', mediaId: 1 } })
    expect(calls.hasPendingWrites()).toBe(true)
    releaseAll()
    await play
    expect(calls.hasPendingWrites()).toBe(false)
  })

  it('waits only for the writes in flight when it was called', async () => {
    const { calls, release } = setup({
      answer: () => ({ kind: 'hold', status: 204, text: '' }),
    })
    const first = calls.call({
      serverId: SERVER.id,
      call: { name: 'saveProgress', mediaId: 1, position: 5 },
    })
    const settled = calls.settleWrites()
    const second = calls.call({ serverId: SERVER.id, call: { name: 'recordPlay', mediaId: 1 } })
    release({ index: 0 })
    await settled
    expect(calls.hasPendingWrites()).toBe(true)
    release({ index: 1 })
    await Promise.all([first, second])
    expect(calls.hasPendingWrites()).toBe(false)
  })

  it('settles a write that failed', async () => {
    const { calls } = setup({ answer: () => ({ kind: 'reject' }) })
    const save = calls.call({
      serverId: SERVER.id,
      call: { name: 'saveProgress', mediaId: 1, position: 5 },
    })
    await calls.settleWrites()
    expect(calls.hasPendingWrites()).toBe(false)
    expect((await save).ok).toBe(false)
  })
})

describe('probeServer', () => {
  const probe = (answer: Answer): Promise<boolean> =>
    probeServer({ fetch: fakeFetch({ answer: () => answer }).fetch, origin: SERVER.origin })

  it('asks GET /api/lock on the origin it is given', async () => {
    const fake = fakeFetch({ answer: () => reply({ text: LOCK_STATE }) })
    await probeServer({ fetch: fake.fetch, origin: SERVER.origin })
    expect(fake.sent).toEqual([
      {
        url: 'https://raven.example/api/lock',
        method: 'GET',
        headers: { accept: 'application/json' },
        body: null,
        timeoutMs: CALL_TIMEOUT_MS,
      },
    ])
  })

  it('is true for a 200 lock state', async () => {
    expect(await probe(reply({ text: LOCK_STATE }))).toBe(true)
  })

  it('is false for a 200 HTML page', async () => {
    expect(await probe(reply({ text: '<html>' }))).toBe(false)
  })

  it('is false for 200 JSON that is not a lock state', async () => {
    expect(await probe(reply({ text: '{"ok":1}' }))).toBe(false)
    expect(await probe(reply({ text: '{"available":true,"unlocked":"no"}' }))).toBe(false)
    expect(await probe(reply({ text: 'null' }))).toBe(false)
  })

  it('is false for a 404, even with a lock state', async () => {
    expect(await probe(reply({ status: 404, text: LOCK_STATE }))).toBe(false)
  })

  it('is false for a redirect status', async () => {
    expect(await probe(reply({ status: 302, text: LOCK_STATE }))).toBe(false)
  })

  it('is false for a rejection or a reply that cannot be read', async () => {
    expect(await probe({ kind: 'reject' })).toBe(false)
    expect(await probe({ kind: 'failText' })).toBe(false)
  })

  it('is false for a reply past MAX_REPLY_CHARS', async () => {
    expect(await probe(reply({ text: `${LOCK_STATE}${' '.repeat(MAX_REPLY_CHARS)}` }))).toBe(false)
  })
})
