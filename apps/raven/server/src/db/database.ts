import { existsSync, mkdirSync, renameSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { Inject, Injectable, type OnModuleDestroy } from '@nestjs/common'
import Sqlite from 'better-sqlite3'
import { SERVER_CONFIG, type ServerConfig } from '@/config'

/**
 * Each entry moves the schema one version forward and runs exactly once,
 * tracked by SQLite's `user_version`. Append new migrations; never edit a
 * shipped one, since existing databases have already run it.
 */
export const MIGRATIONS: readonly string[] = [
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
  `
  ALTER TABLE libraries ADD COLUMN save_progress INTEGER NOT NULL DEFAULT 1;
  ALTER TABLE libraries ADD COLUMN pinned INTEGER NOT NULL DEFAULT 1;
  `,
  // VIEW is an SQL keyword, so the view setting's column is view_mode.
  `
  ALTER TABLE libraries ADD COLUMN sort TEXT NOT NULL DEFAULT 'title';
  ALTER TABLE libraries ADD COLUMN view_mode TEXT NOT NULL DEFAULT 'grid';
  ALTER TABLE libraries ADD COLUMN group_by TEXT NOT NULL DEFAULT 'resolution';
  `,
  // A video's embedded audio and subtitle tracks as JSON, found by the scan's
  // probe so the player need not run ffprobe again. NULL until known.
  `
  ALTER TABLE media ADD COLUMN tracks TEXT;
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

/** The index's file in the data folder. Before raven was renamed it was `weirwood.db`. */
export const DATABASE_FILE = 'raven.db'
const LEGACY_FILE = 'weirwood.db'

/**
 * SQLite keeps recent writes in `-wal` until they are copied into the
 * database, and an index of them in `-shm`, both named after the database, so
 * they move with it. The database itself moves last: a move cut short leaves
 * it under its old name, and the next start finishes the job.
 */
const MOVE_ORDER: readonly string[] = ['-wal', '-shm', '']

/**
 * Renames weirwood's database in `dataDir` to raven's, once, so the index,
 * progress and favourites carry over. Does nothing when raven's file already
 * holds a database or there is nothing to adopt. A zero-byte file holds none
 * yet (SQLite writes its header on first use), so it is replaced. Call it
 * before opening.
 */
export const adoptLegacyDatabase = ({ dataDir }: { dataDir: string }): void => {
  const target = join(dataDir, DATABASE_FILE)
  const legacy = join(dataDir, LEGACY_FILE)
  const holdsDatabase = existsSync(target) && statSync(target).size > 0
  if (holdsDatabase || !existsSync(legacy)) return
  MOVE_ORDER.filter((suffix) => existsSync(legacy + suffix)).forEach((suffix) =>
    renameSync(legacy + suffix, target + suffix),
  )
}

/** The one SQLite connection: libraries and their settings, media metadata, playback progress and favourites. */
@Injectable()
export class DatabaseService implements OnModuleDestroy {
  readonly db: Sqlite.Database

  constructor(@Inject(SERVER_CONFIG) config: ServerConfig) {
    mkdirSync(config.dataDir, { recursive: true })
    adoptLegacyDatabase({ dataDir: config.dataDir })
    this.db = new Sqlite(join(config.dataDir, DATABASE_FILE))
    // WAL lets the API read while a scan writes, which is most of the time.
    this.db.pragma('journal_mode = WAL')
    this.db.pragma('foreign_keys = ON')
    migrate(this.db)
  }

  onModuleDestroy(): void {
    this.db.close()
  }
}
