/*
 * Edit metadata can empty a field TMDB fills: '' for words, or 0 for the
 * year, is written over TMDB's like any edit and shown as nothing.
 */
export const MIGRATION_013 = `
  DROP VIEW shown_items;
  CREATE VIEW shown_items AS
    SELECT i.id, i.type, i.tmdb_id, i.parent_id, i.number,
           COALESCE(o.title, i.title) AS title,
           i.original_title,
           COALESCE(o.sort_title, i.sort_title) AS sort_title,
           NULLIF(COALESCE(o.year, i.year), 0) AS year,
           i.released, i.ended,
           NULLIF(COALESCE(o.summary, i.summary), '') AS summary,
           NULLIF(COALESCE(o.tagline, i.tagline), '') AS tagline,
           NULLIF(COALESCE(o.content_rating, i.content_rating), '') AS content_rating,
           i.runtime, i.studio, i.genres, i.imdb_id, i.tvdb_id, i.fetched_at, i.omdb_fetched_at
      FROM items i
      LEFT JOIN item_overrides o ON o.item_id = i.id;
  `
