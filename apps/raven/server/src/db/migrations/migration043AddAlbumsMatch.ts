/*
 * Where each album stands with MusicBrainz: `pending` until a pass looks,
 * `matched` by a tag's release id or a sure search, `manual` by Fix match,
 * `unmatched` when no release was found, with how sure the search was.
 */
export const MIGRATION_043 = `
  ALTER TABLE albums ADD COLUMN match TEXT NOT NULL DEFAULT 'pending';
  ALTER TABLE albums ADD COLUMN match_confidence INTEGER;
  ALTER TABLE albums ADD COLUMN matched_at TEXT;
  UPDATE albums SET match = 'matched', matched_at = added_at WHERE mbid IS NOT NULL;
  CREATE INDEX albums_library_match ON albums (library_id, match);
  `
