// A library can be left out of home's hero, titles picked in it included.
export const MIGRATION_035 = `
  ALTER TABLE libraries ADD COLUMN in_hero INTEGER NOT NULL DEFAULT 1;
  `
