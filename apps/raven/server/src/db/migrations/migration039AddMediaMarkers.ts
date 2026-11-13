/*
 * Where each file stands in intro detection, and by which version of the
 * detector, so an improved one runs again; and the audio fingerprint of
 * each file's head, kept so a new episode is matched against its season
 * without decoding its neighbours again. A fingerprint is packed uint32
 * points from the file's start, `seconds` long.
 */
export const MIGRATION_039 = `
  ALTER TABLE media ADD COLUMN markers TEXT NOT NULL DEFAULT 'pending';
  ALTER TABLE media ADD COLUMN markers_version INTEGER NOT NULL DEFAULT 0;

  CREATE TABLE media_fingerprints (
    media_id INTEGER NOT NULL REFERENCES media (id) ON DELETE CASCADE,
    region TEXT NOT NULL,
    version INTEGER NOT NULL,
    seconds REAL NOT NULL,
    data BLOB NOT NULL,
    PRIMARY KEY (media_id, region)
  ) WITHOUT ROWID;
  `
