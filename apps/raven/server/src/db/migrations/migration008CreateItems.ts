/*
 * What each file in a Movies or TV shows library is, from TMDB. Items are
 * shared by every file and library that holds them; overrides keep a Fix
 * match by folder, so renames and re-downloads keep it; and media gains
 * what its name says and how far matching got, other libraries being off.
 */
export const MIGRATION_008 = `
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
  `
