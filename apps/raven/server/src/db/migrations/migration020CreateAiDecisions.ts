/*
 * What the AI lookup decided for each group it was asked about, by place
 * as a Fix match is kept: the TMDB id it chose (NULL when it chose nothing
 * or ended without a choice), that result's title, year and poster for the
 * Not matched suggestion, how sure it was, and why. A group with a row is
 * never asked again; Match again clears the rows with no id.
 */
export const MIGRATION_020 = `
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
  `
