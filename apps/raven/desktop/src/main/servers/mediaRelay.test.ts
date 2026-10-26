import { AUTH_REFUSALS, HTTP_METHODS, MEDIA_TICKET_PARAM } from '@raven/core'
import { afterEach, describe, expect, test } from 'bun:test'
import { createServer, type Server } from 'node:http'
import { SIGNAL_EVENTS } from '@/main/bounded'
import type { ServerEntry } from '@/main/desktopConfig'
import {
  ACCOUNT_TICKET_RENEW_MS,
  createAccountTickets,
  TICKET_OUTCOMES,
  type TicketOutcome,
} from '@/main/servers/accountTickets'
import {
  createMediaRelay,
  listenOnLoopback,
  RELAY_HOST,
  RELAY_SECRET_BYTES,
  type UpstreamFetch,
} from '@/main/servers/mediaRelay'
import { HTTP_HEADERS } from '@/shared/httpHeaders'

const SERVER: ServerEntry = {
  id: '00000000-0000-4000-8000-000000000001',
  origin: 'https://raven.example',
  name: 'Vhagar',
}
const OTHER: ServerEntry = { ...SERVER, id: '00000000-0000-4000-8000-000000000002' }

type Heard = {
  url: string
  method: string
  headers: Record<string, string>
  signal: AbortSignal
}

type Answer = {
  status: number
  headers?: Record<string, string>
  body?: string | ReadableStream<Uint8Array> | null
}

const servers: Server[] = []

afterEach(() => {
  servers.splice(0).forEach((server) => {
    server.closeAllConnections()
    server.close()
  })
})

const refusalBody = (reason: string) => JSON.stringify({ reason, message: 'no' })

type AnswerProps = { heard: Heard; count: number }

type SetupProps = {
  answer?: (input: AnswerProps) => Answer
  outcomes?: TicketOutcome[]
}

/**
 * A relay on a real loopback socket over an in-process fake upstream: each request the upstream
 * hears is kept, and `answer` says what it sends back.
 */
const setup = ({
  answer = () => ({
    status: 206,
    headers: {
      [HTTP_HEADERS.contentType]: 'video/x-matroska',
      [HTTP_HEADERS.contentLength]: '4',
      [HTTP_HEADERS.contentRange]: 'bytes 0-3/100',
      [HTTP_HEADERS.acceptRanges]: 'bytes',
      [HTTP_HEADERS.setCookie]: 'a=b',
      [HTTP_HEADERS.etag]: 'x',
    },
    body: 'abcd',
  }),
  outcomes = [],
}: SetupProps = {}) => {
  const heard: Heard[] = []
  const asked: { serverId: string; mediaId: number; isFresh: boolean }[] = []
  const warnings: string[] = []
  const secrets: number[] = []
  const listens = { count: 0 }
  const fetchUpstream: UpstreamFetch = async (input) => {
    heard.push(input)
    const { status, headers = {}, body = null } = answer({ heard: input, count: heard.length })
    const response = new Response(body, { status, headers })
    return { status: response.status, headers: response.headers, body: response.body }
  }
  const listen = listenOnLoopback({
    createServer: (handler) => {
      listens.count += 1
      const server = createServer(handler)
      servers.push(server)
      return server
    },
    warn: () => undefined,
  })
  const relay = createMediaRelay({
    listen,
    fetchUpstream,
    tickets: {
      ticketFor: async (input) => {
        asked.push(input)
        return (
          outcomes[asked.length - 1] ?? {
            kind: TICKET_OUTCOMES.ticket,
            ticket: `account.t${asked.length}`,
          }
        )
      },
    },
    newSecret: (bytes) => {
      secrets.push(bytes)
      return `${'s'.repeat(42)}${secrets.length}`
    },
    warn: (message) => {
      warnings.push(message)
    },
  })
  return { relay, heard, asked, warnings, secrets, listens }
}

const OPEN = { server: SERVER, mediaId: 7, sidecarTrackIds: ['external-0', 'external-3'] }

const rangeOf = (url: string) => fetch(url, { headers: { [HTTP_HEADERS.range]: 'bytes=0-3' } })

describe('open', () => {
  test('answers loopback URLs under a fresh secret, listening once', async () => {
    const { relay, secrets, listens } = setup()
    const first = await relay.open(OPEN)
    expect(first.fileUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/s{42}1\/file$/u)
    expect(first.base).toBe(first.fileUrl.replace(/\/file$/u, ''))
    expect(first.sidecarUrls).toEqual([
      `${first.base}/subtitles/external-0`,
      `${first.base}/subtitles/external-3`,
    ])
    const second = await relay.open(OPEN)
    expect(second.loadId).not.toBe(first.loadId)
    expect(second.base).not.toBe(first.base)
    expect(secrets).toEqual([RELAY_SECRET_BYTES, RELAY_SECRET_BYTES])
    expect(RELAY_SECRET_BYTES).toBe(32)
    expect(listens.count).toBe(1)
  })

  test('a sidecar id that is not external-N is never served', async () => {
    const { relay } = setup()
    const opened = await relay.open({ ...OPEN, sidecarTrackIds: ['../file', 'external-1'] })
    expect(opened.sidecarUrls).toEqual([`${opened.base}/subtitles/external-1`])
  })

  test('a listen that fails is tried again on the next open', async () => {
    const attempts = { count: 0 }
    const relay = createMediaRelay({
      listen: async () => {
        attempts.count += 1
        if (attempts.count === 1) throw new Error('no socket')
        return { port: 4000 }
      },
      fetchUpstream: () => Promise.reject(new Error('unused')),
      tickets: { ticketFor: () => Promise.resolve({ kind: TICKET_OUTCOMES.unreachable }) },
      newSecret: () => 'x'.repeat(43),
      warn: () => undefined,
    })
    await expect(relay.open(OPEN)).rejects.toThrow('no socket')
    expect((await relay.open(OPEN)).fileUrl).toBe(`http://127.0.0.1:4000/${'x'.repeat(43)}/file`)
  })

  test('a secret that is not 32 random bytes in base64url is refused', async () => {
    const relay = createMediaRelay({
      listen: async () => ({ port: 4000 }),
      fetchUpstream: () => Promise.reject(new Error('unused')),
      tickets: { ticketFor: () => Promise.resolve({ kind: TICKET_OUTCOMES.unreachable }) },
      newSecret: () => 'short/../',
      warn: () => undefined,
    })
    await expect(relay.open(OPEN)).rejects.toThrow()
  })
})

describe('listenOnLoopback', () => {
  test('listens on 127.0.0.1 alone, on a port the system picks', async () => {
    const listened: { port: number; host: string }[] = []
    const listen = listenOnLoopback({
      createServer: () => ({
        once: () => undefined,
        on: () => undefined,
        listen: (port, host, onListening) => {
          listened.push({ port, host })
          onListening()
        },
        address: () => ({ address: RELAY_HOST, family: 'IPv4', port: 41_234 }),
      }),
      warn: () => undefined,
    })
    expect(await listen(() => undefined)).toEqual({ port: 41_234 })
    expect(listened).toEqual([{ port: 0, host: '127.0.0.1' }])
  })

  test('an error after it listens is warned, never thrown', async () => {
    const later: { listener: (error: Error) => void } = { listener: () => undefined }
    const warnings: string[] = []
    const listen = listenOnLoopback({
      createServer: () => ({
        once: () => undefined,
        on: (_event, listener) => {
          later.listener = listener
        },
        listen: (_port, _host, onListening) => {
          onListening()
        },
        address: () => ({ address: RELAY_HOST, family: 'IPv4', port: 41_234 }),
      }),
      warn: (message) => {
        warnings.push(message)
      },
    })
    await listen(() => undefined)
    later.listener(new Error('EMFILE accept'))
    expect(warnings).toEqual(['the media relay hit an error on its socket'])
  })

  test('a server with no port fails the listen', async () => {
    const listen = listenOnLoopback({
      createServer: () => ({
        once: () => undefined,
        on: () => undefined,
        listen: (_port, _host, onListening) => {
          onListening()
        },
        address: () => null,
      }),
      warn: () => undefined,
    })
    await expect(listen(() => undefined)).rejects.toThrow()
  })
})

describe('a relayed request', () => {
  test('forwards only Range, with the ticket on the server URL, and passes a 206 back', async () => {
    const { relay, heard, asked } = setup()
    const { fileUrl } = await relay.open(OPEN)
    const response = await fetch(fileUrl, {
      headers: {
        [HTTP_HEADERS.range]: 'bytes=0-3',
        [HTTP_HEADERS.cookie]: 'raven_unlock=a.b',
        [HTTP_HEADERS.authorization]: 'Bearer x',
      },
    })
    expect(response.status).toBe(206)
    expect(await response.text()).toBe('abcd')
    expect(response.headers.get(HTTP_HEADERS.contentType)).toBe('video/x-matroska')
    expect(response.headers.get(HTTP_HEADERS.contentLength)).toBe('4')
    expect(response.headers.get(HTTP_HEADERS.contentRange)).toBe('bytes 0-3/100')
    expect(response.headers.get(HTTP_HEADERS.acceptRanges)).toBe('bytes')
    expect(response.headers.get(HTTP_HEADERS.setCookie)).toBeNull()
    expect(response.headers.get(HTTP_HEADERS.etag)).toBeNull()
    expect(heard.map(({ url, method, headers }) => ({ url, method, headers }))).toEqual([
      {
        url: 'https://raven.example/api/media/7/file?t=account.t1',
        method: HTTP_METHODS.get,
        headers: { [HTTP_HEADERS.range]: 'bytes=0-3' },
      },
    ])
    expect(asked).toEqual([{ serverId: SERVER.id, mediaId: 7, isFresh: false }])
  })

  test('a sidecar goes to its subtitles path, and HEAD stays HEAD', async () => {
    const { relay, heard } = setup({ answer: () => ({ status: 200, body: 'WEBVTT' }) })
    const { sidecarUrls } = await relay.open(OPEN)
    const [first = ''] = sidecarUrls
    const head = await fetch(first, { method: HTTP_METHODS.head })
    expect(head.status).toBe(200)
    expect(heard.map(({ url, method }) => ({ url, method }))).toEqual([
      {
        url: 'https://raven.example/api/media/7/subtitles/external-0?t=account.t1',
        method: HTTP_METHODS.head,
      },
    ])
  })

  test.each([
    [HTTP_METHODS.post, (base: string) => fetch(`${base}/file`, { method: HTTP_METHODS.post })],
    [HTTP_METHODS.put, (base: string) => fetch(`${base}/file`, { method: HTTP_METHODS.put })],
    [HTTP_METHODS.delete, (base: string) => fetch(`${base}/file`, { method: HTTP_METHODS.delete })],
    ['an unknown path', (base: string) => fetch(`${base}/subtitles/external-9`)],
    ['a query', (base: string) => fetch(`${base}/file?x=1`)],
    ['the bare base', (base: string) => fetch(base)],
    ['an unknown secret', (base: string) => fetch(`${base.slice(0, -1)}9/file`)],
  ] as const)('%s is 404 and the upstream hears nothing', async (_label, send) => {
    const { relay, heard, asked } = setup()
    const { base } = await relay.open(OPEN)
    const response = await send(base)
    expect(response.status).toBe(404)
    expect(heard).toEqual([])
    expect(asked).toEqual([])
  })

  test('a stale secret is 404 with nothing sent upstream, however it was retired', async () => {
    const { relay, heard } = setup()
    const first = await relay.open(OPEN)
    await relay.open(OPEN)
    expect((await rangeOf(first.fileUrl)).status).toBe(404)
    const closed = await relay.open(OPEN)
    relay.close(closed.loadId)
    expect((await rangeOf(closed.fileUrl)).status).toBe(404)
    const ofServer = await relay.open(OPEN)
    relay.closeServer(SERVER.id)
    expect((await rangeOf(ofServer.fileUrl)).status).toBe(404)
    const all = await relay.open(OPEN)
    relay.closeAll()
    expect((await rangeOf(all.fileUrl)).status).toBe(404)
    expect(heard).toEqual([])
  })

  test("closing another server or an older load leaves the current load's secret alone", async () => {
    const { relay, heard } = setup()
    const old = await relay.open(OPEN)
    const current = await relay.open(OPEN)
    relay.close(old.loadId)
    relay.closeServer(OTHER.id)
    expect((await rangeOf(current.fileUrl)).status).toBe(206)
    expect(heard.length).toBe(1)
  })

  test("an expired ticket's 401 mints once more and repeats the request", async () => {
    const { relay, heard, asked } = setup({
      answer: ({ count }) =>
        count === 1
          ? { status: 401, body: refusalBody(AUTH_REFUSALS.signedOut) }
          : {
              status: 206,
              headers: { [HTTP_HEADERS.contentRange]: 'bytes 0-3/100' },
              body: 'abcd',
            },
    })
    const { fileUrl, loadId } = await relay.open(OPEN)
    const response = await rangeOf(fileUrl)
    expect(response.status).toBe(206)
    expect(await response.text()).toBe('abcd')
    expect(asked.map(({ isFresh }) => isFresh)).toEqual([false, true])
    expect(heard.map(({ url }) => url)).toEqual([
      'https://raven.example/api/media/7/file?t=account.t1',
      'https://raven.example/api/media/7/file?t=account.t2',
    ])
    expect(heard[1]?.headers ?? null).toEqual({ [HTTP_HEADERS.range]: 'bytes=0-3' })
    expect(relay.refusalOf(loadId)).toBeNull()
  })

  test('a second 401 is passed back and recorded as signed out', async () => {
    const { relay, heard } = setup({
      answer: () => ({ status: 401, body: refusalBody(AUTH_REFUSALS.signedOut) }),
    })
    const { fileUrl, loadId } = await relay.open(OPEN)
    expect((await rangeOf(fileUrl)).status).toBe(401)
    expect(heard.length).toBe(2)
    expect(relay.refusalOf(loadId)).toBe(AUTH_REFUSALS.signedOut)
  })

  test('a 403 is passed back and its reason recorded, without minting again', async () => {
    const { relay, heard, asked } = setup({
      answer: () => ({ status: 403, body: refusalBody(AUTH_REFUSALS.revoked) }),
    })
    const { fileUrl, loadId } = await relay.open(OPEN)
    expect((await rangeOf(fileUrl)).status).toBe(403)
    expect(heard.length).toBe(1)
    expect(asked.length).toBe(1)
    expect(relay.refusalOf(loadId)).toBe(AUTH_REFUSALS.revoked)
  })

  test('a 403 with no reason it can read is recorded as removed access', async () => {
    const { relay } = setup({ answer: () => ({ status: 403 }) })
    const { fileUrl, loadId } = await relay.open(OPEN)
    expect((await fetch(fileUrl, { method: HTTP_METHODS.head })).status).toBe(403)
    expect(relay.refusalOf(loadId)).toBe(AUTH_REFUSALS.revoked)
  })

  test('a refused mint is recorded and nothing goes upstream', async () => {
    const { relay, heard } = setup({
      outcomes: [{ kind: TICKET_OUTCOMES.refused, reason: AUTH_REFUSALS.revoked }],
    })
    const { fileUrl, loadId } = await relay.open(OPEN)
    expect((await rangeOf(fileUrl)).status).toBe(403)
    expect(heard).toEqual([])
    expect(relay.refusalOf(loadId)).toBe(AUTH_REFUSALS.revoked)
  })

  test.each([
    ['a locked library', { kind: TICKET_OUTCOMES.locked }, 423],
    ['a title that is gone', { kind: TICKET_OUTCOMES.gone }, 404],
    ['an unreachable server', { kind: TICKET_OUTCOMES.unreachable }, 502],
    [
      'a signed out account',
      { kind: TICKET_OUTCOMES.refused, reason: AUTH_REFUSALS.signedOut },
      401,
    ],
  ] as const)('a mint that fails for %s answers %d', async (_label, outcome, status) => {
    const { relay, heard } = setup({ outcomes: [outcome] })
    const { fileUrl } = await relay.open(OPEN)
    expect((await rangeOf(fileUrl)).status).toBe(status)
    expect(heard).toEqual([])
  })

  test('the recorded refusal outlives its load, and the next open clears it', async () => {
    const { relay } = setup({
      answer: () => ({ status: 403, body: refusalBody(AUTH_REFUSALS.revoked) }),
    })
    const { fileUrl, loadId } = await relay.open(OPEN)
    await rangeOf(fileUrl)
    relay.close(loadId)
    expect(relay.refusalOf(loadId)).toBe(AUTH_REFUSALS.revoked)
    const next = await relay.open(OPEN)
    expect(relay.refusalOf(loadId)).toBeNull()
    expect(relay.refusalOf(next.loadId)).toBeNull()
  })

  test('a request of a retired load that is refused late records nothing', async () => {
    const held: { release: (outcome: TicketOutcome) => void } = { release: () => undefined }
    const asked = Promise.withResolvers<void>()
    const relay = createMediaRelay({
      listen: listenOnLoopback({
        createServer: (handler) => {
          const server = createServer(handler)
          servers.push(server)
          return server
        },
        warn: () => undefined,
      }),
      fetchUpstream: () => Promise.reject(new Error('unused')),
      tickets: {
        ticketFor: () =>
          new Promise((resolve) => {
            held.release = resolve
            asked.resolve()
          }),
      },
      newSecret: () => 'r'.repeat(43),
      warn: () => undefined,
    })
    const old = await relay.open(OPEN)
    const asking = fetch(old.fileUrl).catch(() => null)
    await asked.promise
    const next = await relay.open(OPEN)
    held.release({ kind: TICKET_OUTCOMES.refused, reason: AUTH_REFUSALS.revoked })
    await asking
    expect(relay.refusalOf(old.loadId)).toBeNull()
    expect(relay.refusalOf(next.loadId)).toBeNull()
  })

  test("a load whose server's access ended is read as signed out, unless the server said more", async () => {
    const { relay } = setup()
    const ended = await relay.open(OPEN)
    relay.closeServer(OTHER.id)
    expect(relay.refusalOf(ended.loadId)).toBeNull()
    relay.closeServer(SERVER.id)
    expect(relay.refusalOf(ended.loadId)).toBe(AUTH_REFUSALS.signedOut)
    const refused = setup({
      answer: () => ({ status: 403, body: refusalBody(AUTH_REFUSALS.revoked) }),
    })
    const removed = await refused.relay.open(OPEN)
    await rangeOf(removed.fileUrl)
    refused.relay.closeServer(SERVER.id)
    expect(refused.relay.refusalOf(removed.loadId)).toBe(AUTH_REFUSALS.revoked)
  })

  test('a refused sidecar is not why the file ends', async () => {
    const { relay } = setup({
      answer: ({ heard }) =>
        heard.url.includes('/subtitles/')
          ? { status: 403, body: refusalBody(AUTH_REFUSALS.revoked) }
          : { status: 206, body: 'abcd' },
    })
    const { fileUrl, sidecarUrls, loadId } = await relay.open(OPEN)
    const [sidecar = ''] = sidecarUrls
    expect((await fetch(sidecar)).status).toBe(403)
    expect(relay.refusalOf(loadId)).toBeNull()
    expect((await rangeOf(fileUrl)).status).toBe(206)
    expect(relay.refusalOf(loadId)).toBeNull()
  })

  test('the file served again after a refusal clears it, and a later refusal is kept afresh', async () => {
    const { relay } = setup({
      answer: ({ count }) =>
        count === 2
          ? { status: 206, body: 'abcd' }
          : { status: 403, body: refusalBody(AUTH_REFUSALS.revoked) },
    })
    const { fileUrl, loadId } = await relay.open(OPEN)
    expect((await rangeOf(fileUrl)).status).toBe(403)
    expect(relay.refusalOf(loadId)).toBe(AUTH_REFUSALS.revoked)
    expect((await rangeOf(fileUrl)).status).toBe(206)
    expect(relay.refusalOf(loadId)).toBeNull()
    expect((await rangeOf(fileUrl)).status).toBe(403)
    expect(relay.refusalOf(loadId)).toBe(AUTH_REFUSALS.revoked)
  })

  test("a refused mint is the load's refusal, as is an access ended in main", async () => {
    const { relay } = setup({
      outcomes: [{ kind: TICKET_OUTCOMES.refused, reason: AUTH_REFUSALS.signedOut }],
    })
    const { fileUrl, loadId } = await relay.open(OPEN)
    await rangeOf(fileUrl)
    expect(relay.refusalOf(loadId)).toBe(AUTH_REFUSALS.signedOut)
    const ended = await relay.open(OPEN)
    relay.closeServer(SERVER.id)
    expect(relay.refusalOf(ended.loadId)).toBe(AUTH_REFUSALS.signedOut)
  })

  test('a refusal is warned without a secret', async () => {
    const warnings: string[] = []
    const relay = createMediaRelay({
      listen: listenOnLoopback({
        createServer: (handler) => {
          const server = createServer(handler)
          servers.push(server)
          return server
        },
        warn: () => undefined,
      }),
      fetchUpstream: async () => {
        const response = new Response(refusalBody(AUTH_REFUSALS.revoked), { status: 403 })
        return { status: response.status, headers: response.headers, body: response.body }
      },
      tickets: {
        ticketFor: () => Promise.resolve({ kind: TICKET_OUTCOMES.ticket, ticket: 'account.t1' }),
      },
      newSecret: () => 'w'.repeat(43),
      warn: (message) => {
        warnings.push(message)
      },
    })
    const { fileUrl } = await relay.open(OPEN)
    await rangeOf(fileUrl)
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(warnings).toEqual(['Vhagar refused a relayed request: revoked'])
  })

  test('seeks past many ticket lifetimes keep playing, one mint per window', async () => {
    const clock = { now: 0 }
    const mintedAt = new Map<string, number>()
    const relay = createMediaRelay({
      listen: listenOnLoopback({
        createServer: (handler) => {
          const server = createServer(handler)
          servers.push(server)
          return server
        },
        warn: () => undefined,
      }),
      // The server takes a ticket for five minutes from its mint, by the same clock.
      fetchUpstream: async ({ url }) => {
        const ticket = new URL(url).searchParams.get(MEDIA_TICKET_PARAM) ?? ''
        const isLive = clock.now < (mintedAt.get(ticket) ?? -Infinity) + 300_000
        const response = isLive
          ? new Response('abcd', {
              status: 206,
              headers: { [HTTP_HEADERS.contentRange]: 'bytes 0-3/100' },
            })
          : new Response(refusalBody(AUTH_REFUSALS.signedOut), { status: 401 })
        return { status: response.status, headers: response.headers, body: response.body }
      },
      tickets: createAccountTickets({
        calls: {
          call: async () => {
            const ticket = `account.t${mintedAt.size + 1}`
            mintedAt.set(ticket, clock.now)
            return { ok: true, status: 200, body: JSON.stringify({ ticket, expiresAt: 0 }) }
          },
        },
        isSignedIn: () => true,
        now: () => clock.now,
      }),
      newSecret: () => 'v'.repeat(43),
      warn: () => undefined,
    })
    const { fileUrl, loadId } = await relay.open(OPEN)
    const statuses = await [0, 1, 2, 3, 4, 5].reduce<Promise<number[]>>(async (done, step) => {
      const seen = await done
      clock.now = step * (ACCOUNT_TICKET_RENEW_MS + 10_000)
      return [...seen, (await rangeOf(fileUrl)).status]
    }, Promise.resolve([]))
    expect(statuses).toEqual([206, 206, 206, 206, 206, 206])
    expect(mintedAt.size).toBe(6)
    clock.now += 3_600_000
    expect((await rangeOf(fileUrl)).status).toBe(206)
    expect(relay.refusalOf(loadId)).toBeNull()
  })

  test('an upstream that fails is a 502', async () => {
    const warnings: string[] = []
    const relay = createMediaRelay({
      listen: listenOnLoopback({
        createServer: (handler) => {
          const server = createServer(handler)
          servers.push(server)
          return server
        },
        warn: () => undefined,
      }),
      fetchUpstream: () =>
        Promise.reject(new Error('https://raven.example/api/media/7/file?t=account.t1 failed')),
      tickets: {
        ticketFor: () => Promise.resolve({ kind: TICKET_OUTCOMES.ticket, ticket: 'account.t1' }),
      },
      newSecret: () => 'q'.repeat(43),
      warn: (message) => {
        warnings.push(message)
      },
    })
    const { fileUrl } = await relay.open(OPEN)
    expect((await rangeOf(fileUrl)).status).toBe(502)
    expect(warnings).toEqual(['the media relay could not reach Vhagar'])
  })

  test('closing the downstream aborts the upstream fetch', async () => {
    const aborted: { signal: AbortSignal | null } = { signal: null }
    const { relay } = setup({
      answer: ({ heard: { signal } }) => {
        aborted.signal = signal
        return {
          status: 206,
          headers: { [HTTP_HEADERS.contentRange]: 'bytes 0-99/100' },
          body: new ReadableStream<Uint8Array>({
            start: (controller) => controller.enqueue(new Uint8Array([1, 2, 3])),
          }),
        }
      },
    })
    const { fileUrl } = await relay.open(OPEN)
    const downstream = new AbortController()
    const response = await fetch(fileUrl, { signal: downstream.signal })
    if (response.body === null) throw new Error('the relay sent no body')
    await response.body.getReader().read()
    downstream.abort()
    const signal = aborted.signal
    if (signal === null) throw new Error('the upstream heard nothing')
    await new Promise<void>((resolve) => {
      if (signal.aborted) resolve()
      signal.addEventListener(SIGNAL_EVENTS.abort, () => resolve())
    })
    expect(signal.aborted).toBe(true)
  })

  test("closing the server's loads aborts what they are still relaying", async () => {
    const aborted: { signal: AbortSignal | null } = { signal: null }
    const { relay } = setup({
      answer: ({ heard: { signal } }) => {
        aborted.signal = signal
        return {
          status: 206,
          body: new ReadableStream<Uint8Array>({
            start: (controller) => controller.enqueue(new Uint8Array([1])),
          }),
        }
      },
    })
    const { fileUrl } = await relay.open(OPEN)
    const response = await fetch(fileUrl)
    if (response.body === null) throw new Error('the relay sent no body')
    await response.body.getReader().read()
    relay.closeServer(SERVER.id)
    expect(aborted.signal?.aborted ?? false).toBe(true)
  })

  test('no warning holds the secret, a ticket or a URL', async () => {
    const { relay, warnings } = setup({
      answer: ({ count }) =>
        count % 2 === 1
          ? { status: 401, body: refusalBody(AUTH_REFUSALS.signedOut) }
          : { status: 403, body: refusalBody(AUTH_REFUSALS.revoked) },
      outcomes: [
        { kind: TICKET_OUTCOMES.ticket, ticket: 'account.secret1' },
        { kind: TICKET_OUTCOMES.ticket, ticket: 'account.secret2' },
        { kind: TICKET_OUTCOMES.refused, reason: AUTH_REFUSALS.pending },
        { kind: TICKET_OUTCOMES.unreachable },
      ],
    })
    const { base, fileUrl } = await relay.open(OPEN)
    await rangeOf(fileUrl)
    await rangeOf(fileUrl)
    await rangeOf(fileUrl)
    await fetch(`${base}/nope`, { method: HTTP_METHODS.post })
    expect(warnings.length).toBeGreaterThan(0)
    const said = warnings.join('\n')
    expect(said).not.toContain('s'.repeat(42))
    expect(said).not.toContain('account.')
    expect(said).not.toContain('http')
    expect(said).not.toContain('127.0.0.1')
    expect(said).not.toContain('raven.example')
  })
})
