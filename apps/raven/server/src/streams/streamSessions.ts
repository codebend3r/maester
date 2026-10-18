import { randomUUID } from 'node:crypto'
import { Injectable } from '@nestjs/common'
import type { PlaybackMode } from '@raven/core'

/** Who is asking: where the requests come from, and what the client calls itself. */
export type StreamClient = { address: string; userAgent: string }

/** One open response, which the registry can read the progress of and cut off. */
export type StreamConnection = {
  close: () => void
  /** Bytes sent on its socket so far; only a change matters. */
  written: () => number
}

/** A stream with no request, progress report or byte sent for this long has ended. */
export const IDLE_MS = 30_000

type Session = {
  id: string
  mediaId: number
  mode: PlaybackMode
  client: StreamClient
  startedAt: number
  lastSeenAt: number
  position: number | null
  connections: Map<StreamConnection, number>
}

export type StreamSession = Pick<
  Session,
  'id' | 'mediaId' | 'mode' | 'client' | 'startedAt' | 'lastSeenAt' | 'position'
>

const keyOf = ({ mediaId, client }: { mediaId: number; client: StreamClient }): string =>
  `${mediaId}\n${client.address}\n${client.userAgent}`

/**
 * What the server is sending, to whom, right now. A direct play is a run of
 * range requests and a conversion one long response, so a stream is one
 * client's use of one video: its requests, whichever way they are served.
 * It is live while it has a request, a progress report or bytes going out
 * within `IDLE_MS`, and a paused player, whose connection may stay open,
 * ends once it stops pulling bytes.
 */
@Injectable()
export class StreamSessions {
  private readonly sessions = new Map<string, Session>()

  /** Registers an open response; call the result when the response closes. */
  open({
    mediaId,
    mode,
    client,
    connection,
    now = Date.now(),
  }: {
    mediaId: number
    mode: PlaybackMode
    client: StreamClient
    connection: StreamConnection
    now?: number
  }): () => void {
    const key = keyOf({ mediaId, client })
    const session = this.sessions.get(key) ?? {
      id: randomUUID(),
      mediaId,
      mode,
      client,
      startedAt: now,
      lastSeenAt: now,
      position: null,
      connections: new Map<StreamConnection, number>(),
    }
    session.mode = mode
    session.lastSeenAt = now
    session.connections.set(connection, connection.written())
    this.sessions.set(key, session)
    return () => {
      session.connections.delete(connection)
    }
  }

  /** The player says where it is. Ignored for a stream that is not registered, such as one just stopped. */
  report({
    mediaId,
    client,
    position,
    now = Date.now(),
  }: {
    mediaId: number
    client: StreamClient
    position: number
    now?: number
  }): void {
    const session = this.sessions.get(keyOf({ mediaId, client }))
    if (session == null) return
    session.position = position
    session.lastSeenAt = now
  }

  /** The live streams, oldest first; those that went quiet are forgotten. */
  list({ now = Date.now() }: { now?: number } = {}): StreamSession[] {
    this.sessions.forEach((session, key) => {
      this.sample({ session, now })
      if (now - session.lastSeenAt >= IDLE_MS) this.sessions.delete(key)
    })
    return [...this.sessions.values()]
      .toSorted((a, b) => a.startedAt - b.startedAt)
      .map(({ id, mediaId, mode, client, startedAt, lastSeenAt, position }) => ({
        id,
        mediaId,
        mode,
        client,
        startedAt,
        lastSeenAt,
        position,
      }))
  }

  /** Cuts off a stream's open responses and forgets it. False when no such stream is live. */
  stop(id: string): boolean {
    const found = [...this.sessions.entries()].find(([, session]) => session.id === id)
    if (found == null) return false
    const [key, session] = found
    this.sessions.delete(key)
    session.connections.forEach((_, connection) => connection.close())
    session.connections.clear()
    return true
  }

  /** A response that sent bytes since the last look is still being read. */
  private sample({ session, now }: { session: Session; now: number }): void {
    session.connections.forEach((before, connection) => {
      const written = connection.written()
      if (written === before) return
      session.connections.set(connection, written)
      session.lastSeenAt = now
    })
  }
}
