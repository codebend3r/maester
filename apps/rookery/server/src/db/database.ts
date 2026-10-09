import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { Inject, Injectable, type OnModuleDestroy } from '@nestjs/common'
import Sqlite from 'better-sqlite3'
import { SERVER_CONFIG, type ServerConfig } from '@/config.js'

/**
 * Each entry moves the schema one version forward and runs exactly once,
 * tracked by SQLite's `user_version`. Append new migrations; never edit a
 * shipped one, since existing databases have already run it.
 */
const MIGRATIONS: readonly string[] = [
  `
  CREATE TABLE users (
    id TEXT PRIMARY KEY,
    display_name TEXT NOT NULL,
    email TEXT,
    thumb TEXT,
    created_at TEXT NOT NULL,
    last_seen_at TEXT NOT NULL
  );

  -- One row per way a person signs in. Plex is ('plex', <Plex account id>);
  -- other providers become more rows, never a change to users.
  CREATE TABLE logins (
    provider TEXT NOT NULL,
    subject TEXT NOT NULL,
    user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    username TEXT,
    email TEXT,
    created_at TEXT NOT NULL,
    last_used_at TEXT NOT NULL,
    PRIMARY KEY (provider, subject)
  );

  CREATE INDEX logins_user ON logins (user_id);

  -- Only the SHA-256 of a session's token is kept; the token itself lives
  -- in the browser's cookie and nowhere else.
  CREATE TABLE sessions (
    token_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    last_seen_at TEXT NOT NULL
  );

  CREATE INDEX sessions_expires ON sessions (expires_at);

  CREATE TABLE pending_sign_ins (
    id TEXT PRIMARY KEY,
    plex_pin_id TEXT NOT NULL,
    plex_code TEXT NOT NULL,
    return_to TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  `,
]

const migrate = (db: Sqlite.Database): void => {
  const current = Number(db.pragma('user_version', { simple: true }))
  MIGRATIONS.slice(current).forEach((sql, offset) => {
    db.transaction(() => {
      db.exec(sql)
      db.pragma(`user_version = ${current + offset + 1}`)
    })()
  })
}

export const DATABASE_FILE = 'rookery.db'

/** The one SQLite connection: users, their logins, sessions and sign-ins under way. */
@Injectable()
export class DatabaseService implements OnModuleDestroy {
  readonly db: Sqlite.Database

  constructor(@Inject(SERVER_CONFIG) config: ServerConfig) {
    mkdirSync(config.dataDir, { recursive: true })
    this.db = new Sqlite(join(config.dataDir, DATABASE_FILE))
    this.db.pragma('journal_mode = WAL')
    this.db.pragma('foreign_keys = ON')
    migrate(this.db)
  }

  onModuleDestroy(): void {
    this.db.close()
  }
}
