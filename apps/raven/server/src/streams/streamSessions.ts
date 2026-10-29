import { randomUUID } from 'node:crypto'
import { Injectable } from '@nestjs/common'
import {
  type Account,
  type PlaybackMode,
  STREAM_PURPOSES,
  type StreamPurpose,
  type StreamQuality,
} from '@raven/core'

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

/**
 * An open response's byte counts: what its socket had written when it
 * opened and at the last look, and the file offset it started at.
 */
type Tracked = { first: number; last: number; from: number }

type Session = {
  id: string
  purpose: StreamPurpose
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
  /** The furthest offset into the file any response has reached. */
  reached: number
  samples: Sample[]
  connections: Map<StreamConnection, Tracked>
}

export type StreamSession = Pick<
  Session,
  | 'id'
  | 'purpose'
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
  /** The furthest offset into the file sent so far. */
  reached: number
}

type KeyOfProps = { purpose: StreamPurpose; mediaId: number; client: StreamClient }

/** Two accounts on one browser are two streams, and a download beside a play of the same video is another. */
const keyOf = ({ purpose, mediaId, client }: KeyOfProps): string =>
  `${purpose}\n${mediaId}\n${client.address}\n${client.userAgent}\n${client.viewer?.id ?? ''}`

type NoteProps = { session: Session; tracked: Tracked; written: number }

/** Counts what a response wrote since the last look, and how far into the file that took it. */
const note = ({ session, tracked, written }: NoteProps): void => {
  session.sent += Math.max(0, written - tracked.last)
  session.reached = Math.max(session.reached, tracked.from + written - tracked.first)
}

const rateOf = (samples: readonly Sample[]): number | null => {
  const first = samples.at(0)
  const last = samples.at(-1)
  if (first == null || last == null || last.at <= first.at) return null
  return ((last.sent - first.sent) * 8 * 1000) / (last.at - first.at)
}

type StreamSessionsOpenProps = {
  purpose: StreamPurpose
  mediaId: number
  mode: PlaybackMode
  quality: StreamQuality | null
  audio: number | null
  client: StreamClient
  connection: StreamConnection
  /** The offset into the file the response starts at: its range's first byte, 0 for a whole file. */
  from: number
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
    purpose,
    mediaId,
    mode,
    quality,
    audio,
    client,
    connection,
    from,
    now = Date.now(),
  }: StreamSessionsOpenProps): () => void {
    const key = keyOf({ purpose, mediaId, client })
    const session = this.sessions.get(key) ?? {
      id: randomUUID(),
      purpose,
      mediaId,
      mode,
      quality,
      client,
      startedAt: now,
      lastSeenAt: now,
      position: null,
      audio,
      sent: 0,
      reached: 0,
      samples: [{ at: now, sent: 0 }],
      connections: new Map<StreamConnection, Tracked>(),
    }
    session.mode = mode
    session.quality = quality
    session.audio = audio ?? session.audio
    session.lastSeenAt = now
    const written = connection.written()
    session.connections.set(connection, { first: written, last: written, from })
    session.reached = Math.max(session.reached, from)
    this.sessions.set(key, session)
    return () => {
      // A range request may close between two looks; what it sent still counts.
      const tracked = session.connections.get(connection)
      if (tracked != null) note({ session, tracked, written: connection.written() })
      session.connections.delete(connection)
    }
  }

  /**
   * The player says where it is, and which audio track plays when it can
   * tell. Ignored for a stream that is not registered, such as one just
   * stopped.
   */
  report({ mediaId, client, position, audio, now = Date.now() }: StreamSessionsReportProps): void {
    const session = this.sessions.get(keyOf({ purpose: STREAM_PURPOSES.play, mediaId, client }))
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
          purpose,
          mediaId,
          mode,
          quality,
          client,
          startedAt,
          lastSeenAt,
          position,
          audio,
          samples,
          reached,
        }) => ({
          id,
          purpose,
          mediaId,
          mode,
          quality,
          client,
          startedAt,
          lastSeenAt,
          position,
          audio,
          sendRate: rateOf(samples),
          reached,
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
    session.connections.forEach((tracked, connection) => {
      const written = connection.written()
      if (written === tracked.last) return
      note({ session, tracked, written })
      session.connections.set(connection, { ...tracked, last: written })
      session.lastSeenAt = now
    })
    session.samples = [
      ...session.samples.filter(({ at }) => now - at <= RATE_WINDOW_MS),
      { at: now, sent: session.sent },
    ]
  }
}
