// Re-read music once to recover full dates discarded by the earlier reader.
export const MIGRATION_045 = `
  ALTER TABLE albums ADD COLUMN release_date TEXT;
  ALTER TABLE albums ADD COLUMN metadata_path TEXT;
  ALTER TABLE albums ADD COLUMN cover_stamp TEXT NOT NULL DEFAULT '';
  UPDATE media SET probed = 0
   WHERE library_id IN (SELECT id FROM libraries WHERE kind = 'music');
  `
