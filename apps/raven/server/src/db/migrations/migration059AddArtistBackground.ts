/**
 * The picture an owner chose for an artist's page in place of the one MusicBrainz links: a
 * Wikimedia Commons address, or `album:<id>` for the cover of one of their albums. Null wears
 * the default photo.
 */
export const MIGRATION_059 = `
  ALTER TABLE artists ADD COLUMN background TEXT;
  `
