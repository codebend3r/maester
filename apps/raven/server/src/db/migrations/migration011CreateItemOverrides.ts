/*
 * Edit metadata: what the viewer wrote over TMDB's, a column per field,
 * NULL where TMDB's stands. The rows in items stay TMDB's own, so a
 * refresh never loses an edit and the original can always be shown.
 * Reads go through shown_items, where the edit wins.
 */
export const MIGRATION_011 = `
  CREATE TABLE item_overrides (
    item_id INTEGER PRIMARY KEY REFERENCES items (id) ON DELETE CASCADE,
    title TEXT,
    sort_title TEXT,
    year INTEGER,
    tagline TEXT,
    summary TEXT,
    content_rating TEXT
  );
  CREATE VIEW shown_items AS
    SELECT i.id, i.type, i.tmdb_id, i.parent_id, i.number,
           COALESCE(o.title, i.title) AS title,
           i.original_title,
           COALESCE(o.sort_title, i.sort_title) AS sort_title,
           COALESCE(o.year, i.year) AS year,
           i.released, i.ended,
           COALESCE(o.summary, i.summary) AS summary,
           COALESCE(o.tagline, i.tagline) AS tagline,
           COALESCE(o.content_rating, i.content_rating) AS content_rating,
           i.runtime, i.studio, i.genres, i.imdb_id, i.tvdb_id, i.fetched_at, i.omdb_fetched_at
      FROM items i
      LEFT JOIN item_overrides o ON o.item_id = i.id;
  `
