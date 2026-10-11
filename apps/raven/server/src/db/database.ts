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
  // One row per sitting with a video: when it was last playing and the
  // furthest it got, so a library's history can say what was watched, by
  // the library's own measure of watched.
  `
  CREATE TABLE plays (
    id INTEGER PRIMARY KEY,
    media_id INTEGER NOT NULL REFERENCES media (id) ON DELETE CASCADE,
    played_at TEXT NOT NULL,
    furthest REAL NOT NULL DEFAULT 0
  );
  CREATE INDEX plays_media ON plays (media_id, played_at);
  ALTER TABLE libraries ADD COLUMN watched_percent INTEGER NOT NULL DEFAULT 90;
  `,
  // What a library holds: 'movies', 'shows' or 'other', the last for those made before.
  `
  ALTER TABLE libraries ADD COLUMN kind TEXT NOT NULL DEFAULT 'other';
  `,
  // What each file in a Movies or TV shows library is, from TMDB. Items are
  // shared by every file and library that holds them; overrides keep a Fix
  // match by folder, so renames and re-downloads keep it; and media gains
  // what its name says and how far matching got, other libraries being off.
  `
  CREATE TABLE items (
    id INTEGER PRIMARY KEY,
    type TEXT NOT NULL,
    tmdb_id TEXT NOT NULL,
    parent_id INTEGER REFERENCES items (id) ON DELETE CASCADE,
    number INTEGER,
    title TEXT NOT NULL,
    original_title TEXT,
    sort_title TEXT NOT NULL,
    year INTEGER,
    released TEXT,
    ended TEXT,
    summary TEXT,
    tagline TEXT,
    content_rating TEXT,
    runtime INTEGER,
    studio TEXT,
    genres TEXT NOT NULL DEFAULT '[]',
    imdb_id TEXT,
    tvdb_id TEXT,
    fetched_at TEXT NOT NULL,
    UNIQUE (type, tmdb_id)
  );
  CREATE INDEX items_parent ON items (parent_id, number);

  CREATE TABLE media_items (
    media_id INTEGER NOT NULL REFERENCES media (id) ON DELETE CASCADE,
    item_id INTEGER NOT NULL REFERENCES items (id) ON DELETE CASCADE,
    PRIMARY KEY (media_id, item_id)
  );
  CREATE INDEX media_items_item ON media_items (item_id);

  CREATE TABLE match_overrides (
    library_id INTEGER NOT NULL REFERENCES libraries (id) ON DELETE CASCADE,
    place TEXT NOT NULL,
    tmdb_id TEXT,
    PRIMARY KEY (library_id, place)
  );

  CREATE TABLE item_images (
    item_id INTEGER NOT NULL REFERENCES items (id) ON DELETE CASCADE,
    kind TEXT NOT NULL,
    source TEXT NOT NULL,
    ref TEXT NOT NULL,
    PRIMARY KEY (item_id, kind, source)
  );

  CREATE TABLE people (
    id INTEGER PRIMARY KEY,
    tmdb_id TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    photo TEXT
  );

  CREATE TABLE credits (
    item_id INTEGER NOT NULL REFERENCES items (id) ON DELETE CASCADE,
    person_id INTEGER NOT NULL REFERENCES people (id) ON DELETE CASCADE,
    job TEXT NOT NULL,
    role TEXT,
    position INTEGER NOT NULL,
    PRIMARY KEY (item_id, person_id, job)
  );
  CREATE INDEX credits_person ON credits (person_id);

  CREATE TABLE ratings (
    item_id INTEGER NOT NULL REFERENCES items (id) ON DELETE CASCADE,
    source TEXT NOT NULL,
    value REAL NOT NULL,
    votes INTEGER,
    PRIMARY KEY (item_id, source)
  );

  ALTER TABLE media ADD COLUMN year INTEGER;
  ALTER TABLE media ADD COLUMN edition TEXT;
  ALTER TABLE media ADD COLUMN match TEXT NOT NULL DEFAULT 'pending';
  UPDATE media SET match = 'off'
    WHERE library_id IN (SELECT id FROM libraries WHERE kind = 'other');
  CREATE INDEX media_match_pending ON media (match) WHERE match = 'pending';
  `,
  // Reviews by TMDB members; which score a library's cards show and sort by;
  // and when OMDb last answered for an item, so its scores fill over days.
  `
  CREATE TABLE reviews (
    id INTEGER PRIMARY KEY,
    item_id INTEGER NOT NULL REFERENCES items (id) ON DELETE CASCADE,
    tmdb_id TEXT NOT NULL UNIQUE,
    author TEXT NOT NULL,
    avatar TEXT,
    rating REAL,
    content TEXT NOT NULL,
    url TEXT NOT NULL,
    written_at TEXT NOT NULL
  );
  CREATE INDEX reviews_item ON reviews (item_id, written_at);
  ALTER TABLE libraries ADD COLUMN ratings_source TEXT NOT NULL DEFAULT 'tmdb';
  ALTER TABLE items ADD COLUMN omdb_fetched_at TEXT;
  `,
  // A Movies library opens on its matched and not matched buckets; one
  // still on the old defaults moves over, a chosen view stays. A TV library
  // is always split that way, so it keeps its grid.
  `
  UPDATE libraries SET view_mode = 'grouped', group_by = 'match'
   WHERE view_mode = 'grid' AND group_by = 'resolution' AND kind = 'movies';
  `,
  // Edit metadata: what the viewer wrote over TMDB's, a column per field,
  // NULL where TMDB's stands. The rows in items stay TMDB's own, so a
  // refresh never loses an edit and the original can always be shown.
  // Reads go through shown_items, where the edit wins.
  `
  CREATE TABLE item_overrides (
    item_id INTEGER PRIMARY KEY REFERENCES items (id) ON DELETE CASCADE,
    title TEXT,
    sort_title TEXT,
    year INTEGER,
    tagline TEXT,
    summary TEXT,
    content_rating TEXT
  );
  CREATE VIEW shown_items AS
    SELECT i.id, i.type, i.tmdb_id, i.parent_id, i.number,
           COALESCE(o.title, i.title) AS title,
           i.original_title,
           COALESCE(o.sort_title, i.sort_title) AS sort_title,
           COALESCE(o.year, i.year) AS year,
           i.released, i.ended,
           COALESCE(o.summary, i.summary) AS summary,
           COALESCE(o.tagline, i.tagline) AS tagline,
           COALESCE(o.content_rating, i.content_rating) AS content_rating,
           i.runtime, i.studio, i.genres, i.imdb_id, i.tvdb_id, i.fetched_at, i.omdb_fetched_at
      FROM items i
      LEFT JOIN item_overrides o ON o.item_id = i.id;
  `,
  // Server-wide settings, one JSON value per key: 'playback' holds how
  // video is played for every viewer.
  `
  CREATE TABLE settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  `,
  // Edit metadata can empty a field TMDB fills: '' for words, or 0 for the
  // year, is written over TMDB's like any edit and shown as nothing.
  `
  DROP VIEW shown_items;
  CREATE VIEW shown_items AS
    SELECT i.id, i.type, i.tmdb_id, i.parent_id, i.number,
           COALESCE(o.title, i.title) AS title,
           i.original_title,
           COALESCE(o.sort_title, i.sort_title) AS sort_title,
           NULLIF(COALESCE(o.year, i.year), 0) AS year,
           i.released, i.ended,
           NULLIF(COALESCE(o.summary, i.summary), '') AS summary,
           NULLIF(COALESCE(o.tagline, i.tagline), '') AS tagline,
           NULLIF(COALESCE(o.content_rating, i.content_rating), '') AS content_rating,
           i.runtime, i.studio, i.genres, i.imdb_id, i.tvdb_id, i.fetched_at, i.omdb_fetched_at
      FROM items i
      LEFT JOIN item_overrides o ON o.item_id = i.id;
  `,
  // A library refreshes itself as its folders change, unless turned off; and
  // each file keeps when it was last found, renamed, moved or replaced, for
  // the Recently changed sort. Files already indexed changed when they came.
  `
  ALTER TABLE libraries ADD COLUMN auto_refresh INTEGER NOT NULL DEFAULT 1;
  ALTER TABLE media ADD COLUMN changed_at TEXT NOT NULL DEFAULT '';
  UPDATE media SET changed_at = added_at;
  CREATE INDEX media_library_changed ON media (library_id, changed_at);
  `,
  // A private library keeps its videos behind the server's PIN.
  `
  ALTER TABLE libraries ADD COLUMN locked INTEGER NOT NULL DEFAULT 0;
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

/** The one SQLite connection: libraries and their settings, media metadata, playback progress, favourites and plays. */
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
