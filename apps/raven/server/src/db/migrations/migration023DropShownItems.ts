/*
 * shown_items reads each edit by its key rather than joining them. SQLite
 * cannot fold a view holding a LEFT JOIN into a query that LEFT JOINs it,
 * which every listing does, so it copied every item on each read; a view
 * of one table it folds in, and reads only the items asked for.
 */
export const MIGRATION_023 = `
  DROP VIEW shown_items;
  CREATE VIEW shown_items AS
    SELECT i.id, i.type, i.tmdb_id, i.parent_id, i.number,
           COALESCE((SELECT o.title FROM item_overrides o WHERE o.item_id = i.id), i.title) AS title,
           i.original_title,
           COALESCE((SELECT o.sort_title FROM item_overrides o WHERE o.item_id = i.id), i.sort_title)
             AS sort_title,
           NULLIF(COALESCE((SELECT o.year FROM item_overrides o WHERE o.item_id = i.id), i.year), 0)
             AS year,
           i.released, i.ended,
           NULLIF(COALESCE((SELECT o.summary FROM item_overrides o WHERE o.item_id = i.id), i.summary), '')
             AS summary,
           NULLIF(COALESCE((SELECT o.tagline FROM item_overrides o WHERE o.item_id = i.id), i.tagline), '')
             AS tagline,
           NULLIF(
             COALESCE((SELECT o.content_rating FROM item_overrides o WHERE o.item_id = i.id), i.content_rating),
             ''
           ) AS content_rating,
           i.runtime, i.studio, i.genres, i.imdb_id, i.tvdb_id, i.fetched_at, i.omdb_fetched_at
      FROM items i;
  `
