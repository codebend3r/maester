/**
 * Why each unmatched album is unmatched, as the Unmatched albums tab shows
 * it on hover, kept so it is asked of MusicBrainz and Claude once: the
 * album's tags as they were read (`tags`, so a change to them asks again)
 * and the contract's `AlbumMatchDiagnosis` as JSON. It goes with its album.
 */
export const MIGRATION_060 = `
  CREATE TABLE album_diagnoses (
    album_id INTEGER PRIMARY KEY REFERENCES albums(id) ON DELETE CASCADE,
    tags TEXT NOT NULL,
    diagnosis TEXT NOT NULL
  );
  `
