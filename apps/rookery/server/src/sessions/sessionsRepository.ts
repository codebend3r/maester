import { createHash, randomBytes } from 'node:crypto'
import { Inject, Injectable } from '@nestjs/common'
import { addMs } from '@/clock.js'
import { DatabaseService } from '@/db/database.js'

/** A session lasts this long from sign-in, then the friend signs in again. */
export const SESSION_MS = 30 * 24 * 60 * 60 * 1000
/** `last_seen_at` moves at most this often, so a busy page does not write on every request. */
const TOUCH_MS = 60 * 1000

export type Session = {
  userId: string
  expiresAt: string
}

export type SessionLookup =
  | { kind: 'live'; session: Session; touched: boolean }
  | { kind: 'unknown' }
  | { kind: 'expired' }

type SessionRow = { user_id: string; expires_at: string; last_seen_at: string }

/** What the database keeps in place of a token: its SHA-256, hex. */
export const hashToken = (token: string): string => createHash('sha256').update(token).digest('hex')

@Injectable()
export class SessionsRepository {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  private get db() {
    return this.database.db
  }

  /** A new session for `userId`; returns the token for the cookie. Expired sessions go first. */
  create({ userId, now }: { userId: string; now: Date }): string {
    const token = randomBytes(32).toString('base64url')
    const at = now.toISOString()
    this.db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(at)
    this.db
      .prepare(
        `INSERT INTO sessions (token_hash, user_id, created_at, expires_at, last_seen_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(hashToken(token), userId, at, addMs({ date: now, ms: SESSION_MS }).toISOString(), at)
    return token
  }

  /** The session behind `token`, moving its `last_seen_at` when it is a minute stale. */
  lookup({ token, now }: { token: string; now: Date }): SessionLookup {
    const hash = hashToken(token)
    const row = this.db
      .prepare<[string], SessionRow>(
        'SELECT user_id, expires_at, last_seen_at FROM sessions WHERE token_hash = ?',
      )
      .get(hash)
    if (!row) return { kind: 'unknown' }
    if (Date.parse(row.expires_at) <= now.getTime()) return { kind: 'expired' }
    const touched = now.getTime() - Date.parse(row.last_seen_at) >= TOUCH_MS
    if (touched) {
      this.db
        .prepare('UPDATE sessions SET last_seen_at = ? WHERE token_hash = ?')
        .run(now.toISOString(), hash)
    }
    return { kind: 'live', session: { userId: row.user_id, expiresAt: row.expires_at }, touched }
  }

  delete(token: string): void {
    this.db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(hashToken(token))
  }
}
