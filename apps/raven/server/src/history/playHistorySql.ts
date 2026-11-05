import type Sqlite from 'better-sqlite3'
import type { AccountKey, ByAccount } from '@/media/viewingAccountKeys'

/** How an entry is kept: a video's follows its play, a listen follows its music player's reports. */
export const PLAY_HISTORY_KINDS = { video: 'video', listen: 'listen' } as const

type KeepVideoSittingProps = {
  db: Sqlite.Database
  account: AccountKey
  /** The play the sitting is, from `plays`. */
  playId: number
  mediaId: number
  at: Date
  position: number
}

/**
 * A video's play began or went on: its history entry starts with it, or
 * moves on with it. Call it inside the play's transaction.
 */
export const keepVideoSitting = ({
  db,
  account,
  playId,
  mediaId,
  at,
  position,
}: KeepVideoSittingProps): void => {
  const when = at.toISOString()
  db.prepare<[ByAccount, string, number, number, string, string, number]>(
    `INSERT INTO play_history (account_id, kind, media_id, play_id, started_at, last_played_at, furthest)
     VALUES (@account, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (play_id) WHERE play_id IS NOT NULL DO UPDATE
       SET last_played_at = excluded.last_played_at,
           furthest = MAX(furthest, excluded.furthest)`,
  ).run({ account }, PLAY_HISTORY_KINDS.video, mediaId, playId, when, when, position)
}
