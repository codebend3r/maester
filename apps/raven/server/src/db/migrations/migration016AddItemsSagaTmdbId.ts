/*
 * A movie's saga: the TMDB collection it belongs to, for a library's Sagas.
 * Movies stored before this learn theirs from TMDB once, in the daily
 * sweep; saga_checked marks the ones that have, every item stored after.
 */
export const MIGRATION_016 = `
  ALTER TABLE items ADD COLUMN saga_tmdb_id TEXT;
  ALTER TABLE items ADD COLUMN saga_name TEXT;
  ALTER TABLE items ADD COLUMN saga_checked INTEGER NOT NULL DEFAULT 0;
  `
