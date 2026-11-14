/*
 * How each account's subtitles look, one size and one colour, kept here so
 * every device an account signs in on draws them the same. The values the
 * two may take are the contract's, not the table's, so a size or colour
 * added later needs no migration.
 */
export const MIGRATION_056 = `
  CREATE TABLE caption_styles (
    account_id TEXT PRIMARY KEY,
    size TEXT NOT NULL,
    colour TEXT NOT NULL
  ) WITHOUT ROWID;
  `
