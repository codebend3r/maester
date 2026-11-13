/*
 * A library's Refresh: the movies and shows whose scores it asked for
 * again, each until a source settles it, when it began, how many titles
 * it asked for, and when the last one finished.
 */
export const MIGRATION_030 = `
  CREATE TABLE score_requests (
    library_id INTEGER NOT NULL REFERENCES libraries (id) ON DELETE CASCADE,
    item_id INTEGER NOT NULL REFERENCES items (id) ON DELETE CASCADE,
    PRIMARY KEY (library_id, item_id)
  );
  CREATE INDEX score_requests_item ON score_requests (item_id);
  ALTER TABLE libraries ADD COLUMN ratings_refresh_started_at TEXT;
  ALTER TABLE libraries ADD COLUMN ratings_refresh_total INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE libraries ADD COLUMN ratings_refreshed_at TEXT;
  `
