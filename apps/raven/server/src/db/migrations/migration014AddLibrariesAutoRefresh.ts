/*
 * A library refreshes itself as its folders change, unless turned off; and
 * each file keeps when it was last found, renamed, moved or replaced, for
 * the Recently changed sort. Files already indexed changed when they came.
 */
export const MIGRATION_014 = `
  ALTER TABLE libraries ADD COLUMN auto_refresh INTEGER NOT NULL DEFAULT 1;
  ALTER TABLE media ADD COLUMN changed_at TEXT NOT NULL DEFAULT '';
  UPDATE media SET changed_at = added_at;
  CREATE INDEX media_library_changed ON media (library_id, changed_at);
  `
