/*
 * How a library's folders are read: 'auto' reads letter folders (A/, #/)
 * and group folders (Requests/) as holding the titles, 'flat' reads every
 * top folder as a title. Each path keeps what its last full scan found:
 * 'flat', 'lettered' or 'grouped', and how many group folders.
 */
export const MIGRATION_019 = `
  ALTER TABLE libraries ADD COLUMN folder_layout TEXT NOT NULL DEFAULT 'auto';
  ALTER TABLE library_paths ADD COLUMN layout TEXT;
  ALTER TABLE library_paths ADD COLUMN group_folders INTEGER NOT NULL DEFAULT 0;
  `
