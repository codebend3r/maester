import type Sqlite from 'better-sqlite3'
import type { AccountKey, ByAccount } from '@/media/viewingAccountKeys'

/** The account's next entry number: one past its newest, read off the key. */
export const NEXT_HISTORY_ID =
  '(SELECT COALESCE(MAX(id), 0) + 1 FROM play_history WHERE account_id = @account)'

type VideoSittingProps = {
  db: Sqlite.Database
  account: AccountKey
  /** The play the sitting is, from `plays`. */
  playId: number
  at: Date
  position: number
}

type StartVideoSittingProps = VideoSittingProps & { mediaId: number }

/**
 * A video's play just began: its history entry starts with it. A track's
 * play makes none, since its player starts its listen itself. Call it
 * inside the play's transaction.
 */
export const startVideoSitting = ({
  db,
  account,
  playId,
  mediaId,
  at,
  position,
}: StartVideoSittingProps): void => {
  const when = at.toISOString()
  db.prepare<[ByAccount, number, number, string, string, number, number]>(
    `INSERT INTO play_history (account_id, id, media_id, play_id, started_at, last_played_at, furthest)
     SELECT @account, ${NEXT_HISTORY_ID}, ?, ?, ?, ?, ?
      WHERE NOT EXISTS (SELECT 1 FROM tracks WHERE media_id = ?)`,
  ).run({ account }, mediaId, playId, when, when, position, mediaId)
}

/**
 * A video's play went on: its entry moves on with it. A play with no entry
 * (a track's) moves nothing. Call it inside the play's transaction.
 */
export const continueVideoSitting = ({
  db,
  account,
  playId,
  at,
  position,
}: VideoSittingProps): void => {
  db.prepare<[ByAccount, string, number, number]>(
    `UPDATE play_history SET last_played_at = ?, furthest = MAX(COALESCE(furthest, 0), ?)
      WHERE account_id = @account AND play_id = ?`,
  ).run({ account }, at.toISOString(), position, playId)
}
