/**
 * Where a bug report sits past the current list: archived_at once the admin
 * archives it, and deleted_at once they delete it from the archive. A
 * deleted report is kept, so the hourly cap still counts it, but no list
 * shows it again.
 */
export const MIGRATION_061 = `
  ALTER TABLE bug_reports ADD COLUMN archived_at TEXT;
  ALTER TABLE bug_reports ADD COLUMN deleted_at TEXT;
  `
