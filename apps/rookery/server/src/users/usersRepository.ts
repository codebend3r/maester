import { randomUUID } from 'node:crypto'
import { Inject, Injectable } from '@nestjs/common'
import { DatabaseService } from '@/db/database.js'
import type { PlexAccount } from '@/plex/plexTv.js'

export type User = {
  id: string
  displayName: string
  email: string | null
  thumb: string | null
}

/** The Plex account linked to a user, as its login row last saw it. */
export type PlexLogin = {
  id: string
  username: string | null
  email: string | null
}

type UserRow = { id: string; display_name: string; email: string | null; thumb: string | null }
type LoginRow = { subject: string; username: string | null; email: string | null }

const PLEX = 'plex'

const toUser = (row: UserRow): User => ({
  id: row.id,
  displayName: row.display_name,
  email: row.email,
  thumb: row.thumb,
})

@Injectable()
export class UsersRepository {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  private get db() {
    return this.database.db
  }

  get(id: string): User | null {
    const row = this.db
      .prepare<[string], UserRow>('SELECT id, display_name, email, thumb FROM users WHERE id = ?')
      .get(id)
    return row ? toUser(row) : null
  }

  plexLogin(userId: string): PlexLogin | null {
    const row = this.db
      .prepare<[string, string], LoginRow>(
        'SELECT subject, username, email FROM logins WHERE user_id = ? AND provider = ?',
      )
      .get(userId, PLEX)
    return row ? { id: row.subject, username: row.username, email: row.email } : null
  }

  /**
   * The user behind a Plex account, created on first sign-in. Each sign-in
   * refreshes the name, email and picture from what Plex says now.
   */
  signInWithPlex({ account, now }: { account: PlexAccount; now: Date }): User {
    const at = now.toISOString()
    return this.db.transaction((): User => {
      const login = this.db
        .prepare<[string, string], { user_id: string }>(
          'SELECT user_id FROM logins WHERE provider = ? AND subject = ?',
        )
        .get(PLEX, account.id)
      const userId = login?.user_id ?? randomUUID()
      if (login) {
        this.db
          .prepare(
            `UPDATE logins SET username = ?, email = ?, last_used_at = ?
             WHERE provider = ? AND subject = ?`,
          )
          .run(account.username, account.email, at, PLEX, account.id)
        this.db
          .prepare(
            `UPDATE users SET display_name = ?, email = ?, thumb = ?, last_seen_at = ?
             WHERE id = ?`,
          )
          .run(account.username, account.email, account.thumb, at, userId)
      } else {
        this.db
          .prepare(
            `INSERT INTO users (id, display_name, email, thumb, created_at, last_seen_at)
             VALUES (?, ?, ?, ?, ?, ?)`,
          )
          .run(userId, account.username, account.email, account.thumb, at, at)
        this.db
          .prepare(
            `INSERT INTO logins
               (provider, subject, user_id, username, email, created_at, last_used_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(PLEX, account.id, userId, account.username, account.email, at, at)
      }
      const user = this.get(userId)
      if (!user) throw new Error(`user ${userId} vanished during sign-in`)
      return user
    })()
  }

  touch({ id, now }: { id: string; now: Date }): void {
    this.db.prepare('UPDATE users SET last_seen_at = ? WHERE id = ?').run(now.toISOString(), id)
  }
}
