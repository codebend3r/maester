import { Inject, Injectable } from '@nestjs/common'
import { DatabaseService } from '@/db/database'
import { fileWatched } from '@/media/mediaSql'
import type { WatchCard } from '@/media/watchedCards'

/** What a play is, as the `plays.kind` column holds it: a real one, a Mark as watched, or a real one Mark as unwatched set aside. */
export const PLAY_KINDS = { played: 'played', marked: 'marked', cleared: 'cleared' } as const

/** Marks cards watched or unwatched, by the rule that a file is watched when a `marked` play or a counting `played` one says so. */
@Injectable()
export class WatchedRepository {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  private get db() {
    return this.database.db
  }

  /**
   * Marks every card watched or unwatched in one transaction, re-reading
   * each card's state as it goes: a card already in the state asked for is
   * left alone, including one an earlier card just changed through a file
   * holding two episodes.
   *
   * Watched writes one `marked` play on the card's best file, dated `at`,
   * as far as the file is long (0 while unprobed), and deletes the resume
   * spot of every file of the card, even in a library that saves no
   * progress: marking is explicit, unlike a report. Unwatched deletes the
   * card's marks, sets its real plays aside as `cleared`, which stay in the
   * history and never count, and deletes its spots.
   */
  set({ cards, watched, at }: { cards: readonly WatchCard[]; watched: boolean; at: Date }): void {
    const isWatched = this.db.prepare<[string], { watched: number }>(
      `SELECT 1 AS watched
         FROM media m
         JOIN libraries l ON l.id = m.library_id
        WHERE m.id IN (SELECT value FROM json_each(?)) AND ${fileWatched('m')}
        LIMIT 1`,
    )
    const mark = this.db.prepare(
      `INSERT INTO plays (media_id, played_at, furthest, kind) VALUES (?, ?, ?, ?)`,
    )
    const dropMarks = this.db.prepare(
      `DELETE FROM plays WHERE kind = ? AND media_id IN (SELECT value FROM json_each(?))`,
    )
    const setAside = this.db.prepare(
      `UPDATE plays SET kind = ?
        WHERE kind = ? AND media_id IN (SELECT value FROM json_each(?))`,
    )
    const clearSpots = this.db.prepare(
      'DELETE FROM playback_progress WHERE media_id IN (SELECT value FROM json_each(?))',
    )
    this.db.transaction(() => {
      cards.forEach((card) => {
        const best = card.files[0]
        if (!best) return
        const ids = JSON.stringify(card.files.map((file) => file.id))
        if (!!isWatched.get(ids) === watched) return
        if (watched) {
          mark.run(best.id, at.toISOString(), best.duration ?? 0, PLAY_KINDS.marked)
        } else {
          dropMarks.run(PLAY_KINDS.marked, ids)
          setAside.run(PLAY_KINDS.cleared, PLAY_KINDS.played, ids)
        }
        clearSpots.run(ids)
      })
    })()
  }
}
