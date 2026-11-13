/*
 * Cards show the critics' Metascore by default; a library still on the
 * old default of TMDB's moves over. A title with no Metascore shows TMDB's.
 */
export const MIGRATION_040 = `
  UPDATE libraries SET ratings_source = 'metacritic' WHERE ratings_source = 'tmdb';
  `
