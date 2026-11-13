/*
 * The icon a library picked, NULL wearing its type's. Sporting events are
 * matched as movies now, so their files wait to be matched: the start-up
 * pass reads their names again, extras going back to off, and matches them.
 */
export const MIGRATION_021 = `
  ALTER TABLE libraries ADD COLUMN icon TEXT;
  UPDATE media SET match = 'pending'
    WHERE library_id IN (SELECT id FROM libraries WHERE kind = 'sports');
  `
