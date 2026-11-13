import { randomBytes } from 'node:crypto'
import { Inject, Injectable } from '@nestjs/common'
import { addMs } from '@/clock'
import { DatabaseService } from '@/db/database'
import type { PlexPin } from '@/plex/plexTv'

/** How long a sign-in may take between pressing the button and Plex sending the browser back. */
export const PENDING_MS = 15 * 60 * 1000

export type PendingSignIn = {
  pin: PlexPin
  returnTo: string
}

type PendingRow = { plex_pin_id: string; plex_code: string; return_to: string }

type PendingSignInsCreateProps = { pin: PlexPin; returnTo: string; now: Date }

type PendingSignInsClaimProps = { id: string; now: Date }

/** Sign-ins under way: the PIN Plex is holding, and where to go once it is approved. */
@Injectable()
export class PendingSignIns {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  private get db() {
    return this.database.db
  }

  /** Saves a new sign-in, pruning ones that ran out; returns its id for the `rookery_pin` cookie. */
  create({ pin, returnTo, now }: PendingSignInsCreateProps): string {
    const id = randomBytes(24).toString('base64url')
    this.db.transaction(() => {
      this.db
        .prepare('DELETE FROM pending_sign_ins WHERE created_at <= ?')
        .run(addMs({ date: now, ms: -PENDING_MS }).toISOString())
      this.db
        .prepare(
          `INSERT INTO pending_sign_ins (id, plex_pin_id, plex_code, return_to, created_at)
           VALUES (?, ?, ?, ?, ?)`,
        )
        .run(id, pin.id, pin.code, returnTo, now.toISOString())
    })()
    return id
  }

  /**
   * Takes the sign-in behind `id` out of the table and hands it over, or null
   * when there is none or it ran out. One statement does both, so a callback
   * that arrives twice finishes the sign-in once.
   */
  claim({ id, now }: PendingSignInsClaimProps): PendingSignIn | null {
    const row = this.db
      .prepare<[string, string], PendingRow>(
        `DELETE FROM pending_sign_ins WHERE id = ? AND created_at > ?
         RETURNING plex_pin_id, plex_code, return_to`,
      )
      .get(id, addMs({ date: now, ms: -PENDING_MS }).toISOString())
    return row
      ? { pin: { id: row.plex_pin_id, code: row.plex_code }, returnTo: row.return_to }
      : null
  }
}
