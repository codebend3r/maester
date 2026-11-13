/*
 * A tag like \`6\` was kept as an album's year and sorted it first by release
 * date. Years no release can have (before 1877, the phonograph's, or past next
 * year: \`EARLIEST_RELEASE_YEAR\` in \`@raven/core\`) go, and MusicBrainz is asked
 * again for those albums' dates.
 */
export const MIGRATION_052 = `
  UPDATE albums SET year = NULL, fetched_at = NULL
   WHERE year < 1877 OR year > CAST(strftime('%Y', 'now') AS INTEGER) + 1;
  UPDATE albums SET original_year = NULL
   WHERE original_year < 1877 OR original_year > CAST(strftime('%Y', 'now') AS INTEGER) + 1;
  UPDATE albums SET release_date = NULL, fetched_at = NULL
   WHERE CAST(substr(release_date, 1, 4) AS INTEGER) < 1877
      OR CAST(substr(release_date, 1, 4) AS INTEGER) > CAST(strftime('%Y', 'now') AS INTEGER) + 1;
  `
