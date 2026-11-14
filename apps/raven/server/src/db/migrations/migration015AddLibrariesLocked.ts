// A private library keeps its videos behind the server's PIN.
export const MIGRATION_015 = `
  ALTER TABLE libraries ADD COLUMN locked INTEGER NOT NULL DEFAULT 0;
  `
