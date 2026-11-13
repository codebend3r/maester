/*
 * Reviews by TMDB members; which score a library's cards show and sort by;
 * and when OMDb last answered for an item, so its scores fill over days.
 */
export const MIGRATION_009 = `
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
  `
