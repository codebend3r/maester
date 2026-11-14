export const MIGRATION_002 = `
  CREATE TABLE favourites (
    media_id INTEGER PRIMARY KEY REFERENCES media (id) ON DELETE CASCADE,
    added_at TEXT NOT NULL
  );
  `
