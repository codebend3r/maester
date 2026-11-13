/*
 * One row per sitting with a video: when it was last playing and the
 * furthest it got, so a library's history can say what was watched, by
 * the library's own measure of watched.
 */
export const MIGRATION_006 = `
  CREATE TABLE plays (
    id INTEGER PRIMARY KEY,
    media_id INTEGER NOT NULL REFERENCES media (id) ON DELETE CASCADE,
    played_at TEXT NOT NULL,
    furthest REAL NOT NULL DEFAULT 0
  );
  CREATE INDEX plays_media ON plays (media_id, played_at);
  ALTER TABLE libraries ADD COLUMN watched_percent INTEGER NOT NULL DEFAULT 90;
  `
