/*
 * What each library's saga pages show behind their titles, a `SagaBackdrop`
 * as JSON; a saga with no row shows the default slideshow.
 */
export const MIGRATION_022 = `
  CREATE TABLE saga_backdrops (
    library_id INTEGER NOT NULL REFERENCES libraries (id) ON DELETE CASCADE,
    saga_tmdb_id TEXT NOT NULL,
    backdrop TEXT NOT NULL CHECK (json_valid(backdrop)),
    PRIMARY KEY (library_id, saga_tmdb_id)
  );
  `
