/*
 * A Movies library opens on its matched and not matched buckets; one
 * still on the old defaults moves over, a chosen view stays. A TV library
 * is always split that way, so it keeps its grid.
 */
export const MIGRATION_010 = `
  UPDATE libraries SET view_mode = 'grouped', group_by = 'match'
   WHERE view_mode = 'grid' AND group_by = 'resolution' AND kind = 'movies';
  `
