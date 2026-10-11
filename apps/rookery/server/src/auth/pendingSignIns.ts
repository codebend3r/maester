import { randomBytes } from 'node:crypto'
import { Inject, Injectable } from '@nestjs/common'
import { addMs } from '@/clock.js'
import { DatabaseService } from '@/db/database.js'
import type { PlexPin } from '@/plex/plexTv.js'

/** How long a sign-in may take between pressing the button and Plex sending the browser back. */
export const PENDING_MS = 15 * 60 * 1000

export type PendingSignIn = {
  id: string
  pin: PlexPin
  returnTo: string
}

type PendingRow = { id: string; plex_pin_id: string; plex_code: string; return_to: string }

/** Sign-ins under way: the PIN Plex is holding, and where to go once it is approved. */
@Injectable()
export class PendingSignIns {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  private get db() {
    return this.database.db
  }

  /** Saves a new sign-in, pruning ones that ran out; returns its id for the `rookery_pin` cookie. */
  create({ pin, returnTo, now }: { pin: PlexPin; returnTo: string; now: Date }): string {
    const id = randomBytes(24).toString('base64url')
    this.db
      .prepare('DELETE FROM pending_sign_ins WHERE created_at <= ?')
      .run(addMs({ date: now, ms: -PENDING_MS }).toISOString())
    this.db
      .prepare(
        `INSERT INTO pending_sign_ins (id, plex_pin_id, plex_code, return_to, created_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(id, pin.id, pin.code, returnTo, now.toISOString())
    return id
  }

  /** The sign-in behind `id`, or null when there is none or it ran out. */
  live({ id, now }: { id: string; now: Date }): PendingSignIn | null {
    const row = this.db
      .prepare<[string, string], PendingRow>(
        `SELECT id, plex_pin_id, plex_code, return_to FROM pending_sign_ins
         WHERE id = ? AND created_at > ?`,
      )
      .get(id, addMs({ date: now, ms: -PENDING_MS }).toISOString())
    return row
      ? { id: row.id, pin: { id: row.plex_pin_id, code: row.plex_code }, returnTo: row.return_to }
      : null
  }

  delete(id: string): void {
    this.db.prepare('DELETE FROM pending_sign_ins WHERE id = ?').run(id)
  }
}
