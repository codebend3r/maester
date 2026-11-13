/*
 * The loudness scan: where each track stands in it, by which scan, and
 * whether a track's or an album's gain came from its tags or the scan. A
 * gain already kept was read from the tags.
 */
export const MIGRATION_046 = `
  ALTER TABLE tracks ADD COLUMN loudness_state TEXT NOT NULL DEFAULT 'pending';
  ALTER TABLE tracks ADD COLUMN loudness_version INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE tracks ADD COLUMN replaygain_source TEXT;
  ALTER TABLE albums ADD COLUMN replaygain_source TEXT;
  UPDATE tracks SET replaygain_source = 'tags' WHERE replaygain_gain IS NOT NULL;
  UPDATE albums SET replaygain_source = 'tags' WHERE replaygain_gain IS NOT NULL;
  `
