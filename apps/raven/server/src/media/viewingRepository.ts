import { Inject, Injectable } from '@nestjs/common'
import type { HistoryEntry } from '@raven/core'
import { DatabaseService } from '@/db/database'
import { FAVOURITE_OUTCOMES, type FavouriteOutcome } from '@/media/favouriteOutcomes'
import { MediaRepository } from '@/media/mediaRepository'
import { fileWatched } from '@/media/mediaSql'
import type { AccountKey, ByAccount } from '@/media/viewingAccountKeys'
import { PLAY_KINDS } from '@/media/watchedRepository'

/** A video played again within this long of its last report is the same sitting, so the same play. */
const SITTING_MS = 30 * 60 * 1000

type HistoryRow = {
  id: number
  last_played_at: string
  plays: number
  furthest: number
  watched: number
  marked: number
}

type ViewingRepositorySetFavouriteProps = {
  id: number
  favourite: boolean
  account: AccountKey
}

type ViewingRepositoryNotePlayProps = {
  id: number
  position: number
  at: Date
  account: AccountKey
}

type ViewingRepositoryRecordPlayProps = {
  id: number
  account: AccountKey
  at?: Date
}

type ViewingRepositoryReportProps = {
  id: number
  position: number
  account: AccountKey
  at?: Date
}

type ViewingRepositoryHistoryProps = {
  libraryId: number
  limit: number
  watchedOnly?: boolean
  account: AccountKey
}

/**
 * What an account did with a video: favourites, plays and the history they
 * make, and the spot to resume from. Every row is the account's own.
 */
@Injectable()
export class ViewingRepository {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(MediaRepository) private readonly media: MediaRepository,
  ) {}

  private get db() {
    return this.database.db
  }

  private exists(id: number): boolean {
    return !!this.db.prepare<[number], { id: number }>('SELECT id FROM media WHERE id = ?').get(id)
  }

  /**
   * Marking a favourite again keeps its original time, so the list does not
   * reshuffle. A locked library's videos are never marked, whether or not
   * the PIN is entered, but unmarking always goes through, so a favourite
   * left behind in a library locked since can still be cleared.
   */
  setFavourite({ id, favourite, account }: ViewingRepositorySetFavouriteProps): FavouriteOutcome {
    return this.db.transaction(() => {
      const row = this.db
        .prepare<[number], { locked: number }>(
          'SELECT l.locked FROM media m JOIN libraries l ON l.id = m.library_id WHERE m.id = ?',
        )
        .get(id)
      if (!row) return FAVOURITE_OUTCOMES.missing
      if (!favourite) {
        this.db
          .prepare('DELETE FROM favourites WHERE account_id = @account AND media_id = ?')
          .run({ account }, id)
        return FAVOURITE_OUTCOMES.done
      }
      if (row.locked) return FAVOURITE_OUTCOMES.locked
      this.db
        .prepare(
          `INSERT INTO favourites (account_id, media_id, added_at) VALUES (@account, ?, ?)
           ON CONFLICT (account_id, media_id) DO NOTHING`,
        )
        .run({ account }, id, new Date().toISOString())
      return FAVOURITE_OUTCOMES.done
    })()
  }

  /**
   * Counts a report at `at` towards the account's play of the video: its
   * latest real one, while it is in the same sitting, or a new one. Another
   * account's sitting, a mark or a play set aside is never continued, so
   * playing again after Mark as unwatched starts a new play. The play lasts
   * until `at`, and has got at least as far as `position`.
   */
  private notePlay({ id, position, at, account }: ViewingRepositoryNotePlayProps): void {
    const since = new Date(at.getTime() - SITTING_MS).toISOString()
    const latest = this.db
      .prepare<[ByAccount, number, string, string], { id: number }>(
        `SELECT id FROM plays
          WHERE account_id = @account AND media_id = ? AND played_at >= ? AND kind = ?
          ORDER BY played_at DESC, id DESC LIMIT 1`,
      )
      .get({ account }, id, since, PLAY_KINDS.played)
    if (latest) {
      this.db
        .prepare(
          `UPDATE plays SET played_at = ?, furthest = MAX(furthest, ?)
            WHERE account_id = @account AND id = ?`,
        )
        .run({ account }, at.toISOString(), position, latest.id)
      return
    }
    this.db
      .prepare(
        `INSERT INTO plays (account_id, media_id, played_at, furthest, kind)
         VALUES (@account, ?, ?, ?, ?)`,
      )
      .run({ account }, id, at.toISOString(), position, PLAY_KINDS.played)
  }

  /** A video started playing. False when there is no such video. */
  recordPlay({ id, account, at = new Date() }: ViewingRepositoryRecordPlayProps): boolean {
    return this.db.transaction(() => {
      if (!this.exists(id)) return false
      this.notePlay({ id, position: 0, at, account })
      return true
    })()
  }

  /**
   * Playback got to `position`: the play's furthest point, for the history,
   * and the spot to resume from, in one write. False when there is no such
   * video.
   *
   * The history is kept whatever the library's progress setting, which is
   * only about resuming. The library's watched percentage counts as
   * finished, the same point at which a play counts as watched, so the next
   * play starts from the top; so do the first few seconds (5s, or 5% of a
   * short clip), which are a misclick rather than a place to come back to. A
   * library with progress saving off records no spot, not even the clearing
   * of a finished video, so turning it back on resumes from the spots it had.
   */
  report({ id, position, account, at = new Date() }: ViewingRepositoryReportProps): boolean {
    return this.db.transaction(() => {
      const target = this.db
        .prepare<
          [number],
          { duration: number | null; save_progress: number; watched_percent: number }
        >(
          `SELECT m.duration, l.save_progress, l.watched_percent
             FROM media m
             JOIN libraries l ON l.id = m.library_id
            WHERE m.id = ?`,
        )
        .get(id)
      if (!target) return false
      this.notePlay({ id, position, at, account })
      if (target.save_progress !== 1) return true
      const duration = target.duration
      const finished = duration != null && position >= (duration * target.watched_percent) / 100
      const barelyStarted = position < Math.min(5, (duration ?? 100) * 0.05)
      if (finished || barelyStarted) {
        this.db
          .prepare('DELETE FROM playback_progress WHERE account_id = @account AND media_id = ?')
          .run({ account }, id)
        return true
      }
      this.db
        .prepare(
          `INSERT INTO playback_progress (account_id, media_id, position, updated_at)
           VALUES (@account, ?, ?, ?)
           ON CONFLICT (account_id, media_id)
           DO UPDATE SET position = excluded.position, updated_at = excluded.updated_at`,
        )
        .run({ account }, id, position, at.toISOString())
      return true
    })()
  }

  /**
   * A library's videos `account` played or marked, each once, by when it
   * last played or was marked. `plays` counts real plays, those since set
   * aside included, and `furthest` only those still counting, so a full play
   * that Mark as unwatched set aside does not read as finished. One counts as
   * watched by the rule of `fileWatched`.
   */
  history({
    libraryId,
    limit,
    watchedOnly = false,
    account,
  }: ViewingRepositoryHistoryProps): HistoryEntry[] {
    const rows = this.db
      .prepare<[ByAccount, number, number], HistoryRow>(
        `SELECT pl.media_id AS id, MAX(pl.played_at) AS last_played_at,
                COUNT(CASE WHEN pl.kind <> 'marked' THEN 1 END) AS plays,
                COALESCE(MAX(CASE WHEN pl.kind = 'played' THEN pl.furthest END), 0) AS furthest,
                ${fileWatched('m')} AS watched,
                MAX(pl.kind = 'marked') AS marked
           FROM plays pl
           JOIN media m ON m.id = pl.media_id
           JOIN libraries l ON l.id = m.library_id
          WHERE pl.account_id = @account AND m.library_id = ?
          GROUP BY pl.media_id
          ${watchedOnly ? 'HAVING watched = 1' : ''}
          ORDER BY last_played_at DESC, pl.media_id DESC
          LIMIT ?`,
      )
      .all({ account }, libraryId, limit)
    const media = new Map(
      this.media
        .getMany({ ids: rows.map((row) => row.id), account })
        .map((item) => [item.id, item]),
    )
    return rows.flatMap((row): HistoryEntry[] => {
      const item = media.get(row.id)
      return item
        ? [
            {
              media: item,
              lastPlayedAt: row.last_played_at,
              plays: row.plays,
              furthest: row.furthest,
              watched: row.watched === 1,
              marked: row.marked === 1,
            },
          ]
        : []
    })
  }
}
