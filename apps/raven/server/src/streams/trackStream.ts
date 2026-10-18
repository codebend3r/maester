import type { PlaybackMode } from '@raven/core'
import type { FastifyReply, FastifyRequest } from 'fastify'
import { RAVEN_HEADERS } from '@/http'
import type { StreamClient, StreamSessions } from '@/streams/streamSessions'

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

/** Registers a media response as part of its client's stream until it closes. */
export const trackStream = ({
  sessions,
  mediaId,
  mode,
  request,
  reply,
}: {
  sessions: StreamSessions
  mediaId: number
  mode: PlaybackMode
  request: FastifyRequest
  reply: FastifyReply
}): void => {
  const release = sessions.open({
    mediaId,
    mode,
    client: clientOf(request),
    connection: {
      close: () => reply.raw.destroy(),
      written: () => reply.raw.socket?.bytesWritten ?? 0,
    },
  })
  reply.raw.on('close', release)
}
