import { existsSync, renameSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { Inject, Injectable, type OnModuleDestroy } from '@nestjs/common'
import { openSqlite, refreshStatistics } from '@shared/server'
import type Sqlite from 'better-sqlite3'
import { SERVER_CONFIG, type ServerConfig } from '@/config'

/**
 * raven's schema, one version per entry; `openSqlite` runs the ones a
 * database has not run yet. Append new migrations; never edit a shipped one,
 * since existing databases have already run it.
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
  // A movie's saga: the TMDB collection it belongs to, for a library's Sagas.
  // Movies stored before this learn theirs from TMDB once, in the daily
  // sweep; saga_checked marks the ones that have, every item stored after.
  `
  ALTER TABLE items ADD COLUMN saga_tmdb_id TEXT;
  ALTER TABLE items ADD COLUMN saga_name TEXT;
  ALTER TABLE items ADD COLUMN saga_checked INTEGER NOT NULL DEFAULT 0;
  `,
  // A movie's logo, its title as art, sits in item_images as kind 'logo'.
  // Movies stored before this learn theirs from TMDB once, in the daily
  // sweep; logo_checked marks the ones that have, every item stored after.
  `
  ALTER TABLE items ADD COLUMN logo_checked INTEGER NOT NULL DEFAULT 0;
  `,
  // A movie's files in one library share its card unless split apart:
  // NULL keeps a file on the movie's own card, 'file:<id>' gives it a card
  // of its own, named by its media id, and 'cut:<label>' one it shares with
  // the movie's other files of that cut. Kept on the file, so rescans and
  // renames keep it too; matching the file to another movie clears it.
  `
  ALTER TABLE media ADD COLUMN split TEXT;
  `,
  // How a library's folders are read: 'auto' reads letter folders (A/, #/)
  // and group folders (Requests/) as holding the titles, 'flat' reads every
  // top folder as a title. Each path keeps what its last full scan found:
  // 'flat', 'lettered' or 'grouped', and how many group folders.
  `
  ALTER TABLE libraries ADD COLUMN folder_layout TEXT NOT NULL DEFAULT 'auto';
  ALTER TABLE library_paths ADD COLUMN layout TEXT;
  ALTER TABLE library_paths ADD COLUMN group_folders INTEGER NOT NULL DEFAULT 0;
  `,
  // What the AI lookup decided for each group it was asked about, by place
  // as a Fix match is kept: the TMDB id it chose (NULL when it chose nothing
  // or ended without a choice), that result's title, year and poster for the
  // Not matched suggestion, how sure it was, and why. A group with a row is
  // never asked again; Match again clears the rows with no id.
  `
  CREATE TABLE ai_decisions (
    library_id INTEGER NOT NULL REFERENCES libraries (id) ON DELETE CASCADE,
    place TEXT NOT NULL,
    tmdb_id TEXT,
    title TEXT,
    year INTEGER,
    poster TEXT,
    confidence TEXT NOT NULL,
    reason TEXT NOT NULL,
    model TEXT NOT NULL,
    decided_at TEXT NOT NULL,
    PRIMARY KEY (library_id, place)
  );
  `,
  // The icon a library picked, NULL wearing its type's. Sporting events are
  // matched as movies now, so their files wait to be matched: the start-up
  // pass reads their names again, extras going back to off, and matches them.
  `
  ALTER TABLE libraries ADD COLUMN icon TEXT;
  UPDATE media SET match = 'pending'
    WHERE library_id IN (SELECT id FROM libraries WHERE kind = 'sports');
  `,
  // What each library's saga pages show behind their titles, a `SagaBackdrop`
  // as JSON; a saga with no row shows the default slideshow.
  `
  CREATE TABLE saga_backdrops (
    library_id INTEGER NOT NULL REFERENCES libraries (id) ON DELETE CASCADE,
    saga_tmdb_id TEXT NOT NULL,
    backdrop TEXT NOT NULL CHECK (json_valid(backdrop)),
    PRIMARY KEY (library_id, saga_tmdb_id)
  );
  `,
  // shown_items reads each edit by its key rather than joining them. SQLite
  // cannot fold a view holding a LEFT JOIN into a query that LEFT JOINs it,
  // which every listing does, so it copied every item on each read; a view
  // of one table it folds in, and reads only the items asked for.
  `
  DROP VIEW shown_items;
  CREATE VIEW shown_items AS
    SELECT i.id, i.type, i.tmdb_id, i.parent_id, i.number,
           COALESCE((SELECT o.title FROM item_overrides o WHERE o.item_id = i.id), i.title) AS title,
           i.original_title,
           COALESCE((SELECT o.sort_title FROM item_overrides o WHERE o.item_id = i.id), i.sort_title)
             AS sort_title,
           NULLIF(COALESCE((SELECT o.year FROM item_overrides o WHERE o.item_id = i.id), i.year), 0)
             AS year,
           i.released, i.ended,
           NULLIF(COALESCE((SELECT o.summary FROM item_overrides o WHERE o.item_id = i.id), i.summary), '')
             AS summary,
           NULLIF(COALESCE((SELECT o.tagline FROM item_overrides o WHERE o.item_id = i.id), i.tagline), '')
             AS tagline,
           NULLIF(
             COALESCE((SELECT o.content_rating FROM item_overrides o WHERE o.item_id = i.id), i.content_rating),
             ''
           ) AS content_rating,
           i.runtime, i.studio, i.genres, i.imdb_id, i.tvdb_id, i.fetched_at, i.omdb_fetched_at
      FROM items i;
  `,
  // Each library's counts read these rather than every file: the files no
  // match was found for, and the probed files' sizes, for how many are 4K.
  // Both are partial so a read of a library's files by library alone never
  // picks one: a full index sorted by size would scatter that read across
  // the table, where the indexes it uses keep the order files came in.
  // Probing and matching fill them without changing how many files there
  // are, so their statistics stay as a library's first scan left them; that
  // is harmless only while no other read can use them.
  `
  CREATE INDEX media_library_unmatched ON media (library_id) WHERE match = 'unmatched';
  CREATE INDEX media_library_probed ON media (library_id, width, height) WHERE width IS NOT NULL;
  `,
  // A play is a real one ('played'), one Mark as watched wrote ('marked',
  // which always counts), or a real one Mark as unwatched set aside
  // ('cleared', which stays in the history and never counts). Watched at is
  // now also where a resume spot clears, so a library still at the old
  // default of 90 moves to 95, and a spot at or past its library's
  // threshold, which a watched play would have cleared, goes. A file whose
  // length is unknown has no threshold, so it keeps its spot.
  `
  ALTER TABLE plays ADD COLUMN kind TEXT NOT NULL DEFAULT 'played'
    CHECK (kind IN ('played', 'marked', 'cleared'));
  UPDATE libraries SET watched_percent = 95 WHERE watched_percent = 90;
  DELETE FROM playback_progress
   WHERE media_id IN (
     SELECT m.id
       FROM media m
       JOIN libraries l ON l.id = m.library_id
       JOIN playback_progress p ON p.media_id = m.id
      WHERE m.duration > 0 AND p.position >= m.duration * l.watched_percent / 100.0);
  `,
  // When each library's last full scan and last quick scan finished, so the
  // Libraries page still says after a restart. Null until each has run.
  `
  ALTER TABLE libraries ADD COLUMN full_scanned_at TEXT;
  ALTER TABLE libraries ADD COLUMN quick_scanned_at TEXT;
  `,
  // A show's logo sits in item_images as a movie's does; shows stored before
  // learn theirs from TMDB once, in the daily sweep. Shows and seasons can
  // be favourites as videos can, one row each, by item.
  `
  UPDATE items SET logo_checked = 0 WHERE type = 'show';
  CREATE TABLE item_favourites (
    item_id INTEGER PRIMARY KEY REFERENCES items (id) ON DELETE CASCADE,
    added_at TEXT NOT NULL
  );
  `,
  // What TMDB says of a person and everything they appear in, for the person
  // page. `filmography_fetched_at` is null until the credits were fetched, and
  // `department` is TMDB's own, with `Acting` for a cast credit. One person
  // can hold several credits on one title, so `credit_id` is the key.
  `
  ALTER TABLE people ADD COLUMN imdb_id TEXT;
  ALTER TABLE people ADD COLUMN birthday TEXT;
  ALTER TABLE people ADD COLUMN deathday TEXT;
  ALTER TABLE people ADD COLUMN place_of_birth TEXT;
  ALTER TABLE people ADD COLUMN biography TEXT;
  ALTER TABLE people ADD COLUMN known_for TEXT;
  ALTER TABLE people ADD COLUMN filmography_fetched_at TEXT;
  CREATE TABLE person_credits (
    person_id INTEGER NOT NULL REFERENCES people (id) ON DELETE CASCADE,
    credit_id TEXT NOT NULL,
    type TEXT NOT NULL CHECK (type IN ('movie', 'show')),
    tmdb_id TEXT NOT NULL,
    title TEXT NOT NULL,
    released TEXT,
    poster TEXT,
    genre_ids TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(genre_ids)),
    department TEXT NOT NULL,
    role TEXT,
    episodes INTEGER,
    position INTEGER NOT NULL,
    PRIMARY KEY (person_id, credit_id)
  );
  `,
  // Which provider wrote each score, so MDBList's and OMDb's never wipe each
  // other's, and when MDBList last answered for an item. Every score that is
  // not TMDB's came from OMDb until now.
  `
  ALTER TABLE ratings ADD COLUMN provider TEXT NOT NULL DEFAULT 'tmdb';
  UPDATE ratings SET provider = 'omdb' WHERE source <> 'tmdb';
  ALTER TABLE items ADD COLUMN mdblist_fetched_at TEXT;
  `,
]

/** The index's file in the data folder. Before raven was renamed it was `weirwood.db`. */
const DATABASE_FILE = 'raven.db'
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
    adoptLegacyDatabase({ dataDir: config.dataDir })
    // WAL lets the API read while a scan writes, which is most of the time.
    this.db = openSqlite({ dataDir: config.dataDir, file: DATABASE_FILE, migrations: MIGRATIONS })
  }

  /**
   * Brings the query planner's statistics in line with the rows, after work
   * that can add or remove thousands of them: a scan, or a matching pass.
   */
  refreshStatistics(): void {
    refreshStatistics({ db: this.db })
  }

  onModuleDestroy(): void {
    this.db.close()
  }
}
