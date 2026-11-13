/*
 * Server-wide settings, one JSON value per key: 'playback' holds how
 * video is played for every viewer.
 */
export const MIGRATION_012 = `
  CREATE TABLE settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  `
