/*
 * The shows each account is binging, kept here so every device an account
 * signs in on sees the same list, and whether it has dismissed the binge
 * tip. The limit on how many is the service's, not the table's.
 */
export const MIGRATION_050 = `
  CREATE TABLE binge_shows (
    account_id TEXT NOT NULL,
    item_id INTEGER NOT NULL REFERENCES items (id) ON DELETE CASCADE,
    added_at TEXT NOT NULL,
    PRIMARY KEY (account_id, item_id)
  ) WITHOUT ROWID;
  CREATE INDEX binge_shows_item ON binge_shows (item_id);

  CREATE TABLE binge_tips (
    account_id TEXT PRIMARY KEY
  ) WITHOUT ROWID;
  `
