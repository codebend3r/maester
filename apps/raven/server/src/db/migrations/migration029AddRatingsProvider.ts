/*
 * Which provider wrote each score, so MDBList's and OMDb's never wipe each
 * other's, and when MDBList last answered for an item. Every score that is
 * not TMDB's came from OMDb until now.
 */
export const MIGRATION_029 = `
  ALTER TABLE ratings ADD COLUMN provider TEXT NOT NULL DEFAULT 'tmdb';
  UPDATE ratings SET provider = 'omdb' WHERE source <> 'tmdb';
  ALTER TABLE items ADD COLUMN mdblist_fetched_at TEXT;
  `
