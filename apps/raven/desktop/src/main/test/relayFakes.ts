import { createServer, type RequestListener, type Server } from 'node:http'
import type { ServerEntry } from '@/main/desktopConfig'
import { TICKET_OUTCOMES, type TicketOutcome } from '@/main/servers/accountTickets'
import { createMediaRelay, listenOnLoopback, RELAYED_MEDIA_KINDS } from '@/main/servers/mediaRelay'
import type { UpstreamFetch } from '@/main/servers/relayUpstream'
import { fakeTimers } from '@/main/test/playerFakes'
import { fixedPicks } from '@/main/test/serverFakes'
import { HEADERS } from '@shared/http'

export const SERVER: ServerEntry = {
  id: '00000000-0000-4000-8000-000000000001',
  origin: 'https://raven.example',
}

type Heard = {
  url: string
  method: string
  headers: Record<string, string>
  signal: AbortSignal
}

export type Answer = {
  status: number
  headers?: Record<string, string>
  body?: string | ReadableStream<Uint8Array> | null
}

const servers: Server[] = []

/** A `node:http` server for a relay, closed by `closeRelayServers`. */
export const loopbackServer = (handler: RequestListener): Server => {
  const server = createServer(handler)
  servers.push(server)
  return server
}

/** Closes every loopback server the relays set up so far: each relay test file runs it after each test. */
export const closeRelayServers = (): void => {
  servers.splice(0).forEach((server) => {
    server.closeAllConnections()
    server.close()
  })
}

export const refusalBody = (reason: string) => JSON.stringify({ reason, message: 'no' })

export type AnswerProps = { heard: Heard; count: number }

type SetupProps = {
  /** What the upstream sends back; one that throws or rejects is a fetch that failed to connect. */
  answer?: (input: AnswerProps) => Answer | Promise<Answer>
  outcomes?: TicketOutcome[]
  /** One load at a time, as the video relay keeps, unless a test asks for the music relay's two. */
  capacity?: number
}

/**
 * A relay on a real loopback socket over an in-process fake upstream: each request the upstream
 * hears is kept, and `answer` says what it sends back.
 */
export const setupRelay = ({
  answer = () => ({
    status: 206,
    headers: {
      [HEADERS.contentType]: 'video/x-matroska',
      [HEADERS.contentLength]: '4',
      [HEADERS.contentRange]: 'bytes 0-3/100',
      [HEADERS.acceptRanges]: 'bytes',
      [HEADERS.setCookie]: 'a=b',
      [HEADERS.etag]: 'x',
    },
    body: 'abcd',
  }),
  outcomes = [],
  capacity = 1,
}: SetupProps = {}) => {
  const heard: Heard[] = []
  const asked: { mediaId: number; isFresh: boolean }[] = []
  const warnings: string[] = []
  const secrets: number[] = []
  const listens = { count: 0 }
  const { picks, forgets } = fixedPicks({ serverOrigin: SERVER.origin })
  const { timers, pending } = fakeTimers()
  const fetchUpstream: UpstreamFetch = async (input) => {
    heard.push(input)
    const {
      status,
      headers = {},
      body = null,
    } = await answer({
      heard: input,
      count: heard.length,
    })
    const response = new Response(body, { status, headers })
    return { status: response.status, headers: response.headers, body: response.body }
  }
  const listen = listenOnLoopback({
    createServer: (handler) => {
      listens.count += 1
      return loopbackServer(handler)
    },
    warn: () => undefined,
  })
  const relay = createMediaRelay({
    serverOrigin: SERVER.origin,
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
    capacity,
    picks,
    timers,
    warn: (message) => {
      warnings.push(message)
    },
  })
  return { relay, heard, asked, warnings, secrets, listens, forgets, pending }
}

export const OPEN = {
  origin: SERVER.origin,
  mediaId: 7,
  sidecarTrackIds: ['external-0', 'external-3'],
  media: { kind: RELAYED_MEDIA_KINDS.file },
} as const
