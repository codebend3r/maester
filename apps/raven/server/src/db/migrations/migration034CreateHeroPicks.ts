/*
 * The movies and shows the admin picked for home's hero, one row each, in
 * the order they were picked. With none, the hero shows each pinned
 * library's newest release.
 */
export const MIGRATION_034 = `
  CREATE TABLE hero_picks (
    item_id INTEGER PRIMARY KEY REFERENCES items (id) ON DELETE CASCADE,
    picked_at TEXT NOT NULL
  );
  `
