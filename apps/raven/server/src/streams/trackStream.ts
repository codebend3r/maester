import type { PlaybackMode } from '@raven/core'
import type { FastifyReply, FastifyRequest } from 'fastify'
import type { AccessRechecks } from '@/auth/accessRechecks'
import { RAVEN_HEADERS } from '@/http'
import type { StreamClient, StreamSessions } from '@/streams/streamSessions'

/** The events of a Node response that raven listens for. */
export const RESPONSE_EVENTS = { close: 'close' } as const

const headerOf = (value: string | string[] | undefined): string =>
  (Array.isArray(value) ? value[0] : value) ?? ''

/**
 * Who sent a request. Behind a proxy the socket is the proxy's, so the first
 * address it forwards wins; the header is the client's to set, which is
 * fine for a label on the admin's Streams page and for nothing else.
 */
export const clientOf = (request: FastifyRequest): StreamClient => ({
  address:
    headerOf(request.headers[RAVEN_HEADERS.forwardedFor]).split(',')[0]?.trim() || request.ip,
  userAgent: headerOf(request.headers[RAVEN_HEADERS.userAgent]),
})

/**
 * Registers a media response as part of its client's stream until it
 * closes, and destroys it once its account loses access. Destroyed, never
 * ended: a clean end short of the length promised leaves the client
 * waiting on the rest, while a reset makes it ask again by range.
 */
export const trackStream = ({
  sessions,
  rechecks,
  mediaId,
  mode,
  request,
  reply,
}: {
  sessions: StreamSessions
  rechecks: Pick<AccessRechecks, 'ended'>
  mediaId: number
  mode: PlaybackMode
  request: FastifyRequest
  reply: FastifyReply
}): void => {
  const connection = {
    close: () => reply.raw.destroy(),
    written: () => reply.raw.socket?.bytesWritten ?? 0,
  }
  const release = sessions.open({ mediaId, mode, client: clientOf(request), connection })
  const recheck = rechecks.ended({ request }).subscribe(() => connection.close())
  reply.raw.on(RESPONSE_EVENTS.close, () => {
    release()
    recheck.unsubscribe()
  })
}
