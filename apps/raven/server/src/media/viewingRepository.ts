import { Inject, Injectable } from '@nestjs/common'
import type { HistoryEntry } from '@raven/core'
import { DatabaseService } from '@/db/database'
import { MediaRepository } from '@/media/mediaRepository'
import { isWatched } from '@/media/mediaSql'

/** A video played again within this long of its last report is the same sitting, so the same play. */
const SITTING_MS = 30 * 60 * 1000

type HistoryRow = {
  id: number
  last_played_at: string
  plays: number
  furthest: number
  watched: number
}

/**
 * What a viewer did with a video: favourites, plays and the history they
 * make, and the spot to resume from.
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
   * reshuffle. False when there is no such video.
   */
  setFavourite({ id, favourite }: { id: number; favourite: boolean }): boolean {
    return this.db.transaction(() => {
      if (!this.exists(id)) return false
      if (!favourite) {
        this.db.prepare('DELETE FROM favourites WHERE media_id = ?').run(id)
        return true
      }
      this.db
        .prepare(
          `INSERT INTO favourites (media_id, added_at) VALUES (?, ?)
           ON CONFLICT (media_id) DO NOTHING`,
        )
        .run(id, new Date().toISOString())
      return true
    })()
  }

  /**
   * Counts a report at `at` towards the video's play: its latest, while it
   * is in the same sitting, or a new one. The play lasts until `at`, and has
   * got at least as far as `position`.
   */
  private notePlay({ id, position, at }: { id: number; position: number; at: Date }): void {
    const since = new Date(at.getTime() - SITTING_MS).toISOString()
    const latest = this.db
      .prepare<[number, string], { id: number }>(
        `SELECT id FROM plays WHERE media_id = ? AND played_at >= ?
          ORDER BY played_at DESC, id DESC LIMIT 1`,
      )
      .get(id, since)
    if (latest) {
      this.db
        .prepare('UPDATE plays SET played_at = ?, furthest = MAX(furthest, ?) WHERE id = ?')
        .run(at.toISOString(), position, latest.id)
      return
    }
    this.db
      .prepare('INSERT INTO plays (media_id, played_at, furthest) VALUES (?, ?, ?)')
      .run(id, at.toISOString(), position)
  }

  /** A video started playing. False when there is no such video. */
  recordPlay({ id, at = new Date() }: { id: number; at?: Date }): boolean {
    return this.db.transaction(() => {
      if (!this.exists(id)) return false
      this.notePlay({ id, position: 0, at })
      return true
    })()
  }

  /**
   * Playback got to `position`: the play's furthest point, for the history,
   * and the spot to resume from, in one write. False when there is no such
   * video.
   *
   * The history is kept whatever the library's progress setting, which is
   * only about resuming. The last 5% counts as finished, so the next play
   * starts from the top; so do the first few seconds (5s, or 5% of a short
   * clip), which are a misclick rather than a place to come back to. A
   * library with progress saving off records no spot, not even the clearing
   * of a finished video, so turning it back on resumes from the spots it had.
   */
  report({ id, position, at = new Date() }: { id: number; position: number; at?: Date }): boolean {
    return this.db.transaction(() => {
      const target = this.db
        .prepare<[number], { duration: number | null; save_progress: number }>(
          `SELECT m.duration, l.save_progress
             FROM media m
             JOIN libraries l ON l.id = m.library_id
            WHERE m.id = ?`,
        )
        .get(id)
      if (!target) return false
      this.notePlay({ id, position, at })
      if (target.save_progress !== 1) return true
      const duration = target.duration
      const finished = duration != null && position >= duration * 0.95
      const barelyStarted = position < Math.min(5, (duration ?? 100) * 0.05)
      if (finished || barelyStarted) {
        this.db.prepare('DELETE FROM playback_progress WHERE media_id = ?').run(id)
        return true
      }
      this.db
        .prepare(
          `INSERT INTO playback_progress (media_id, position, updated_at) VALUES (?, ?, ?)
           ON CONFLICT (media_id) DO UPDATE SET position = excluded.position, updated_at = excluded.updated_at`,
        )
        .run(id, position, at.toISOString())
      return true
    })()
  }

  /**
   * A library's played videos, each once, by when it last played. One counts
   * as watched once a play got past the library's watched percentage; one
   * whose length is still unknown never does.
   */
  history({
    libraryId,
    limit,
    watchedOnly = false,
  }: {
    libraryId: number
    limit: number
    watchedOnly?: boolean
  }): HistoryEntry[] {
    const rows = this.db
      .prepare<[number, number], HistoryRow>(
        `SELECT pl.media_id AS id, MAX(pl.played_at) AS last_played_at, COUNT(*) AS plays,
                MAX(pl.furthest) AS furthest,
                CASE WHEN ${isWatched('MAX(pl.furthest)')} THEN 1 ELSE 0 END AS watched
           FROM plays pl
           JOIN media m ON m.id = pl.media_id
           JOIN libraries l ON l.id = m.library_id
          WHERE m.library_id = ?
          GROUP BY pl.media_id
          ${watchedOnly ? 'HAVING watched = 1' : ''}
          ORDER BY last_played_at DESC, pl.media_id DESC
          LIMIT ?`,
      )
      .all(libraryId, limit)
    const media = new Map(
      this.media.getMany(rows.map((row) => row.id)).map((item) => [item.id, item]),
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
            },
          ]
        : []
    })
  }
}
