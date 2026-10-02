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
  CREATE TABLE libraries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE library_paths (
    library_id INTEGER NOT NULL REFERENCES libraries (id) ON DELETE CASCADE,
    path TEXT NOT NULL,
    position INTEGER NOT NULL,
    PRIMARY KEY (library_id, path)
  );

  CREATE TABLE media (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    library_id INTEGER NOT NULL REFERENCES libraries (id) ON DELETE CASCADE,
    path TEXT NOT NULL,
    file_name TEXT NOT NULL,
    folder TEXT NOT NULL,
    title TEXT NOT NULL,
    container TEXT NOT NULL,
    size INTEGER NOT NULL,
    mtime_ms INTEGER NOT NULL,
    probed INTEGER NOT NULL DEFAULT 0,
    probe_error TEXT,
    duration REAL,
    width INTEGER,
    height INTEGER,
    video_codec TEXT,
    video_bit_depth INTEGER,
    hdr INTEGER NOT NULL DEFAULT 0,
    audio_codec TEXT,
    audio_channels INTEGER,
    bitrate INTEGER,
    thumbnail TEXT NOT NULL DEFAULT 'pending',
    added_at TEXT NOT NULL,
    UNIQUE (library_id, path)
  );

  CREATE INDEX media_library_title ON media (library_id, title COLLATE NOCASE);
  CREATE INDEX media_library_added ON media (library_id, added_at);
  CREATE INDEX media_thumbnail_pending ON media (thumbnail) WHERE thumbnail = 'pending';

  CREATE TABLE playback_progress (
    media_id INTEGER PRIMARY KEY REFERENCES media (id) ON DELETE CASCADE,
    position REAL NOT NULL,
    updated_at TEXT NOT NULL
  );
  `,
  `
  CREATE TABLE favourites (
    media_id INTEGER PRIMARY KEY REFERENCES media (id) ON DELETE CASCADE,
    added_at TEXT NOT NULL
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

/** The one SQLite connection: the library index, media metadata, playback progress and favourites. */
@Injectable()
export class DatabaseService implements OnModuleDestroy {
  readonly db: Sqlite.Database

  constructor(@Inject(SERVER_CONFIG) config: ServerConfig) {
    mkdirSync(config.dataDir, { recursive: true })
    this.db = new Sqlite(join(config.dataDir, 'weirwood.db'))
    // WAL lets the API read while a scan writes, which is most of the time.
    this.db.pragma('journal_mode = WAL')
    this.db.pragma('foreign_keys = ON')
    migrate(this.db)
  }

  onModuleDestroy(): void {
    this.db.close()
  }
}
