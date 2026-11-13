// What a library holds: 'movies', 'shows' or 'other', the last for those made before.
export const MIGRATION_007 = `
  ALTER TABLE libraries ADD COLUMN kind TEXT NOT NULL DEFAULT 'other';
  `
