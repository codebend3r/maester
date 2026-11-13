/*
 * When each library's last full scan and last quick scan finished, so the
 * Libraries page still says after a restart. Null until each has run.
 */
export const MIGRATION_026 = `
  ALTER TABLE libraries ADD COLUMN full_scanned_at TEXT;
  ALTER TABLE libraries ADD COLUMN quick_scanned_at TEXT;
  `
