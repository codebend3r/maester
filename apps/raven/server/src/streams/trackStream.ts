import type { PlaybackMode, StreamPurpose, StreamQuality } from '@raven/core'
import type { FastifyReply, FastifyRequest } from 'fastify'
import type { Observable } from 'rxjs'
import { type AuthSessions, accountOf } from '@/auth/authSessions'
import { RAVEN_HEADERS, headerOf } from '@/http'
import { clientAddressOf } from '@/remoteAccess/clientNetwork'
import type { StreamClient, StreamSessions } from '@/streams/streamSessions'

/** The events of a Node response that raven listens for. */
export const RESPONSE_EVENTS = { close: 'close' } as const

type ClientOfProps = {
  request: FastifyRequest
  auth: Pick<AuthSessions, 'callerOf'>
}

/**
 * Who sent a request: the address raven trusts (`clientAddressOf`), past
 * the proxies `RAVEN_TRUSTED_PROXIES` names, never a place in a header the
 * client wrote. The viewer is the account the gate bound to the request,
 * never a header's.
 */
export const clientOf = ({ request, auth }: ClientOfProps): StreamClient => {
  const account = accountOf(auth.callerOf({ request }))
  return {
    address: clientAddressOf({ request }),
    userAgent: headerOf(request.headers[RAVEN_HEADERS.userAgent]),
    viewer: account == null ? null : { id: account.id, email: account.email },
  }
}

type TrackStreamProps = {
  sessions: StreamSessions
  /** What ends the response: emits once its access is gone. */
  ended: Observable<void>
  auth: Pick<AuthSessions, 'callerOf'>
  purpose: StreamPurpose
  mediaId: number
  mode: PlaybackMode
  quality: StreamQuality | null
  audio: number | null
  /** The offset into the file the response starts at. */
  from: number
  request: FastifyRequest
  reply: FastifyReply
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
  purpose,
  mediaId,
  mode,
  quality,
  audio,
  from,
  request,
  reply,
}: TrackStreamProps): void => {
  // A finished response lets go of its socket before it says it closed, so
  // the count is read off the socket held from the start.
  const socket = reply.raw.socket
  const connection = {
    close: () => reply.raw.destroy(),
    written: () => socket?.bytesWritten ?? 0,
  }
  const release = sessions.open({
    purpose,
    mediaId,
    mode,
    quality,
    audio,
    client: clientOf({ request, auth }),
    connection,
    from,
  })
  const watch = ended.subscribe(() => connection.close())
  reply.raw.on(RESPONSE_EVENTS.close, () => {
    release()
    watch.unsubscribe()
  })
}
