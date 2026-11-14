/*
 * Cached anime movies can still carry regional re-release dates. The boot
 * sweep fetches their original dates again; failures stay stale for retry.
 */
export const MIGRATION_051 = `
  UPDATE items SET fetched_at = '1970-01-01T00:00:00.000Z'
   WHERE type = 'movie' AND tmdb_id NOT LIKE 'local:%'
     AND id IN (
       SELECT mi.item_id FROM media_items mi
         JOIN media m ON m.id = mi.media_id
         JOIN libraries l ON l.id = m.library_id
        WHERE l.kind = 'animeMovies'
     );
  `
