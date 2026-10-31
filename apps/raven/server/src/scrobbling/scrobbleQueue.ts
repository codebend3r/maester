import { Inject, Injectable } from '@nestjs/common'
import { LIBRARY_KINDS, type ScrobbleService, isScrobbleService } from '@raven/core'
import { CLOCK, type Clock } from '@/clock'
import { DatabaseService } from '@/db/database'
import type { AccountKey } from '@/media/viewingAccountKeys'

/** A listen counts at half the track or this many seconds, whichever comes first. */
const LISTEN_POINT_SECONDS = 240

/** One listen waiting to go to one service for one account. */
export type QueuedListen = {
  account: AccountKey
  service: ScrobbleService
  id: number
  mediaId: number
  /** Unix seconds: when the listen began. */
  listenedAt: number
  /** How often sending it has failed. */
  attempts: number
  /** The MusicBrainz release its album was matched to, if any. */
  releaseMbid: string | null
}

type QueueKey = { account: AccountKey; service: ScrobbleService; id: number }

type ScrobbleQueueNoteListenProps = {
  mediaId: number
  account: AccountKey
  /** The services that can send now; a link to another waits for nothing. */
  services: readonly ScrobbleService[]
}

type ScrobbleQueueNextDueProps = { service: ScrobbleService }

type ScrobbleQueueNextAtProps = { service: ScrobbleService }

type ScrobbleQueueDropBeforeProps = { seconds: number }

type ScrobbleQueueRemoveProps = QueueKey

type ScrobbleQueueRetryProps = QueueKey & { attempts: number; nextAt: number }

type DueRow = Omit<QueuedListen, 'service'> & { service: string }

/**
 * The listens waiting to go out, per account and service. A play is
 * queued only for a track in a music library, never an audiobook, once for
 * each service the account links that can send, as having begun half the
 * track or 240 s before it was counted, as the client counts it.
 */
@Injectable()
export class ScrobbleQueue {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  private get db() {
    return this.database.db
  }

  /** Queues the play of `mediaId`; how many services it was queued for. */
  noteListen({ mediaId, account, services }: ScrobbleQueueNoteListenProps): number {
    const now = this.clock.now()
    return this.db
      .prepare(
        `INSERT INTO scrobble_queue (account_id, service, id, media_id, listened_at, attempts, next_at)
         SELECT l.account_id, l.service,
                coalesce((SELECT max(q.id) FROM scrobble_queue q
                           WHERE q.account_id = l.account_id AND q.service = l.service), 0) + 1,
                m.id,
                @seconds - CAST(min(coalesce(m.duration, 0) / 2, @point) AS INTEGER),
                0, @now
           FROM scrobble_links l
           JOIN media m ON m.id = @mediaId
           JOIN libraries lib ON lib.id = m.library_id AND lib.kind = @music
           JOIN tracks t ON t.media_id = m.id
          WHERE l.account_id = @account
            AND l.service IN (SELECT value FROM json_each(@services))`,
      )
      .run({
        mediaId,
        account,
        now,
        seconds: Math.floor(now / 1000),
        point: LISTEN_POINT_SECONDS,
        music: LIBRARY_KINDS.music,
        services: JSON.stringify(services),
      }).changes
  }

  /** The listen for `service` due longest ago, or null with none due now. */
  nextDue({ service }: ScrobbleQueueNextDueProps): QueuedListen | null {
    const row = this.db
      .prepare<{ service: ScrobbleService; now: number }, DueRow>(
        `SELECT q.account_id AS account, q.service, q.id, q.media_id AS mediaId,
                q.listened_at AS listenedAt, q.attempts, a.mbid AS releaseMbid
           FROM scrobble_queue q
           LEFT JOIN tracks t ON t.media_id = q.media_id
           LEFT JOIN albums a ON a.id = t.album_id
          WHERE q.service = @service AND q.next_at <= @now
          ORDER BY q.next_at LIMIT 1`,
      )
      .get({ service, now: this.clock.now() })
    if (row === undefined || !isScrobbleService(row.service)) return null
    return { ...row, service: row.service }
  }

  /** When the next listen for `service` falls due, in the clock's milliseconds; null with none waiting. */
  nextAt({ service }: ScrobbleQueueNextAtProps): number | null {
    return (
      this.db
        .prepare<[ScrobbleService], { at: number | null }>(
          'SELECT min(next_at) AS at FROM scrobble_queue WHERE service = ?',
        )
        .get(service)?.at ?? null
    )
  }

  /** Drops every listen begun before `seconds` (Unix), whatever service it waits for; how many went. */
  dropBefore({ seconds }: ScrobbleQueueDropBeforeProps): number {
    return this.db.prepare('DELETE FROM scrobble_queue WHERE listened_at < ?').run(seconds).changes
  }

  /** A listen sent, or given up on. */
  remove({ account, service, id }: ScrobbleQueueRemoveProps): void {
    this.db
      .prepare(
        `DELETE FROM scrobble_queue
          WHERE account_id = @account AND service = @service AND id = @id`,
      )
      .run({ account, service, id })
  }

  /** A listen that failed, to be tried again at `nextAt`. */
  retry({ account, service, id, attempts, nextAt }: ScrobbleQueueRetryProps): void {
    this.db
      .prepare(
        `UPDATE scrobble_queue SET attempts = @attempts, next_at = @nextAt
          WHERE account_id = @account AND service = @service AND id = @id`,
      )
      .run({ account, service, id, attempts, nextAt })
  }
}
