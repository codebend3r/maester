import { randomUUID } from 'node:crypto'
import { Injectable } from '@nestjs/common'
import type { Account, PlaybackMode, StreamQuality } from '@raven/core'

/**
 * Who is asking: where the requests come from, what the client calls
 * itself, and the account signed in, or null on a server without accounts.
 */
export type StreamClient = {
  address: string
  userAgent: string
  viewer: Pick<Account, 'id' | 'email'> | null
}

/** One open response, which the registry can read the progress of and cut off. */
export type StreamConnection = {
  close: () => void
  /** Bytes sent on its socket so far; only a change matters. */
  written: () => number
}

/** A stream with no request, progress report or byte sent for this long has ended. */
export const IDLE_MS = 30_000

/** How far back the send rate looks: long enough to smooth a player's bursts, short enough to follow a change. */
const RATE_WINDOW_MS = 10_000

/** The bytes a stream had sent by a moment, for the rate between two of them. */
type Sample = { at: number; sent: number }

type Session = {
  id: string
  mediaId: number
  mode: PlaybackMode
  quality: StreamQuality | null
  client: StreamClient
  startedAt: number
  lastSeenAt: number
  position: number | null
  audio: number | null
  /** Bytes sent across every response so far, closed ones included. */
  sent: number
  samples: Sample[]
  connections: Map<StreamConnection, number>
}

export type StreamSession = Pick<
  Session,
  | 'id'
  | 'mediaId'
  | 'mode'
  | 'quality'
  | 'client'
  | 'startedAt'
  | 'lastSeenAt'
  | 'position'
  | 'audio'
> & {
  /** Bits per second over the last `RATE_WINDOW_MS`, or null until two looks apart. */
  sendRate: number | null
}

type KeyOfProps = { mediaId: number; client: StreamClient }

/** Two accounts on one browser are two streams. */
const keyOf = ({ mediaId, client }: KeyOfProps): string =>
  `${mediaId}\n${client.address}\n${client.userAgent}\n${client.viewer?.id ?? ''}`

const rateOf = (samples: readonly Sample[]): number | null => {
  const first = samples.at(0)
  const last = samples.at(-1)
  if (first == null || last == null || last.at <= first.at) return null
  return ((last.sent - first.sent) * 8 * 1000) / (last.at - first.at)
}

type StreamSessionsOpenProps = {
  mediaId: number
  mode: PlaybackMode
  quality: StreamQuality | null
  audio: number | null
  client: StreamClient
  connection: StreamConnection
  now?: number
}

type StreamSessionsReportProps = {
  mediaId: number
  client: StreamClient
  position: number
  audio: number | null
  now?: number
}

type StreamSessionsListProps = { now?: number }

type StreamSessionsSampleProps = { session: Session; now: number }

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

  /**
   * Registers an open response; call the result when the response closes.
   * `audio` is the track a converted stream asked for, null for direct
   * play, which leaves the one the player last reported.
   */
  open({
    mediaId,
    mode,
    quality,
    audio,
    client,
    connection,
    now = Date.now(),
  }: StreamSessionsOpenProps): () => void {
    const key = keyOf({ mediaId, client })
    const session = this.sessions.get(key) ?? {
      id: randomUUID(),
      mediaId,
      mode,
      quality,
      client,
      startedAt: now,
      lastSeenAt: now,
      position: null,
      audio,
      sent: 0,
      samples: [{ at: now, sent: 0 }],
      connections: new Map<StreamConnection, number>(),
    }
    session.mode = mode
    session.quality = quality
    session.audio = audio ?? session.audio
    session.lastSeenAt = now
    session.connections.set(connection, connection.written())
    this.sessions.set(key, session)
    return () => {
      // A range request may close between two looks; what it sent still counts.
      const before = session.connections.get(connection)
      if (before != null) session.sent += Math.max(0, connection.written() - before)
      session.connections.delete(connection)
    }
  }

  /**
   * The player says where it is, and which audio track plays when it can
   * tell. Ignored for a stream that is not registered, such as one just
   * stopped.
   */
  report({ mediaId, client, position, audio, now = Date.now() }: StreamSessionsReportProps): void {
    const session = this.sessions.get(keyOf({ mediaId, client }))
    if (session == null) return
    session.position = position
    session.audio = audio ?? session.audio
    session.lastSeenAt = now
  }

  /** The live streams, oldest first; those that went quiet are forgotten. */
  list({ now = Date.now() }: StreamSessionsListProps = {}): StreamSession[] {
    this.sessions.forEach((session, key) => {
      this.sample({ session, now })
      if (now - session.lastSeenAt >= IDLE_MS) this.sessions.delete(key)
    })
    return [...this.sessions.values()]
      .toSorted((a, b) => a.startedAt - b.startedAt)
      .map(
        ({
          id,
          mediaId,
          mode,
          quality,
          client,
          startedAt,
          lastSeenAt,
          position,
          audio,
          samples,
        }) => ({
          id,
          mediaId,
          mode,
          quality,
          client,
          startedAt,
          lastSeenAt,
          position,
          audio,
          sendRate: rateOf(samples),
        }),
      )
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

  /**
   * A response that sent bytes since the last look is still being read.
   * Each look also notes the bytes sent so far, for the send rate.
   */
  private sample({ session, now }: StreamSessionsSampleProps): void {
    session.connections.forEach((before, connection) => {
      const written = connection.written()
      if (written === before) return
      session.sent += written - before
      session.connections.set(connection, written)
      session.lastSeenAt = now
    })
    session.samples = [
      ...session.samples.filter(({ at }) => now - at <= RATE_WINDOW_MS),
      { at: now, sent: session.sent },
    ]
  }
}
