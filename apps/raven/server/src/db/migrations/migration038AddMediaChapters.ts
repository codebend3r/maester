/*
 * A file's chapters, a JSON array read with its probe and cleared when the
 * file changes; null until read, so a file probed before is read on its
 * first play. And where its intro and credits are, one of each at most,
 * in seconds on the file's clock: a stronger source replaces a weaker one,
 * and an admin's own (manual) outlives a replaced file.
 */
export const MIGRATION_038 = `
  ALTER TABLE media ADD COLUMN chapters TEXT;

  CREATE TABLE media_markers (
    media_id INTEGER NOT NULL REFERENCES media (id) ON DELETE CASCADE,
    kind TEXT NOT NULL,
    start_s REAL NOT NULL,
    end_s REAL NOT NULL,
    source TEXT NOT NULL,
    confidence REAL NOT NULL,
    detected_at TEXT NOT NULL,
    PRIMARY KEY (media_id, kind)
  ) WITHOUT ROWID;
  `
