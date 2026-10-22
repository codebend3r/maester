import type { PlaybackMode, StreamQuality } from '@raven/core'
import type { FastifyReply, FastifyRequest } from 'fastify'
import type { Observable } from 'rxjs'
import { type AuthSessions, accountOf } from '@/auth/authSessions'
import { RAVEN_HEADERS } from '@/http'
import type { StreamClient, StreamSessions } from '@/streams/streamSessions'

/** The events of a Node response that raven listens for. */
export const RESPONSE_EVENTS = { close: 'close' } as const

const headerOf = (value: string | string[] | undefined): string =>
  (Array.isArray(value) ? value[0] : value) ?? ''

/**
 * Who sent a request. Behind a proxy the socket is the proxy's, so the first
 * address it forwards wins; the header is the client's to set, which is
 * fine for a label on the admin's Streams page and for nothing else. The
 * viewer is the account the gate bound to the request, never a header's.
 */
export const clientOf = ({
  request,
  auth,
}: {
  request: FastifyRequest
  auth: Pick<AuthSessions, 'callerOf'>
}): StreamClient => {
  const account = accountOf(auth.callerOf({ request }))
  return {
    address:
      headerOf(request.headers[RAVEN_HEADERS.forwardedFor]).split(',')[0]?.trim() || request.ip,
    userAgent: headerOf(request.headers[RAVEN_HEADERS.userAgent]),
    viewer: account == null ? null : { id: account.id, email: account.email },
  }
}

/**
 * Registers a media response as part of its client's stream until it
 * closes, and destroys it once `ended` emits: its account's recheck, and on
 * `file` the end of the pass that opened it too. Destroyed, never ended: a
 * clean end short of the length promised leaves the client waiting on the
 * rest, while a reset makes it ask again by range.
 */
export const trackStream = ({
  sessions,
  ended,
  auth,
  mediaId,
  mode,
  quality,
  audio,
  request,
  reply,
}: {
  sessions: StreamSessions
  /** What ends the response: emits once its access is gone. */
  ended: Observable<void>
  auth: Pick<AuthSessions, 'callerOf'>
  mediaId: number
  mode: PlaybackMode
  quality: StreamQuality | null
  audio: number | null
  request: FastifyRequest
  reply: FastifyReply
}): void => {
  // A finished response lets go of its socket before it says it closed, so
  // the count is read off the socket held from the start.
  const socket = reply.raw.socket
  const connection = {
    close: () => reply.raw.destroy(),
    written: () => socket?.bytesWritten ?? 0,
  }
  const release = sessions.open({
    mediaId,
    mode,
    quality,
    audio,
    client: clientOf({ request, auth }),
    connection,
  })
  const watch = ended.subscribe(() => connection.close())
  reply.raw.on(RESPONSE_EVENTS.close, () => {
    release()
    watch.unsubscribe()
  })
}
