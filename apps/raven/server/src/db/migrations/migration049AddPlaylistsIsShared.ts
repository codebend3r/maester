/*
 * A playlist its owner shares, which every account on the server may
 * read, play and copy; every playlist kept so far stays its owner's. The
 * shared ones are few, so a partial index finds them without the rest.
 */
export const MIGRATION_049 = `
  ALTER TABLE playlists ADD COLUMN is_shared INTEGER NOT NULL DEFAULT 0;
  CREATE INDEX playlists_shared ON playlists (is_shared) WHERE is_shared = 1;
  `
