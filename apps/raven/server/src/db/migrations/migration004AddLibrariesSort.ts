// VIEW is an SQL keyword, so the view setting's column is view_mode.
export const MIGRATION_004 = `
  ALTER TABLE libraries ADD COLUMN sort TEXT NOT NULL DEFAULT 'title';
  ALTER TABLE libraries ADD COLUMN view_mode TEXT NOT NULL DEFAULT 'grid';
  ALTER TABLE libraries ADD COLUMN group_by TEXT NOT NULL DEFAULT 'resolution';
  `
