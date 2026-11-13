// The admin's order for the libraries; one never placed has none and follows the placed ones.
export const MIGRATION_037 = `
  ALTER TABLE libraries ADD COLUMN position INTEGER;
  `
