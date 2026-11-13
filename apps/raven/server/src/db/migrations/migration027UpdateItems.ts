/*
 * A show's logo sits in item_images as a movie's does; shows stored before
 * learn theirs from TMDB once, in the daily sweep. Shows and seasons can
 * be favourites as videos can, one row each, by item.
 */
export const MIGRATION_027 = `
  UPDATE items SET logo_checked = 0 WHERE type = 'show';
  CREATE TABLE item_favourites (
    item_id INTEGER PRIMARY KEY REFERENCES items (id) ON DELETE CASCADE,
    added_at TEXT NOT NULL
  );
  `
