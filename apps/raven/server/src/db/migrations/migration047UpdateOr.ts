/*
 * The artists ListenBrainz finds similar to each of ours, shared by every
 * account and asked again after 30 days. A similar artist is kept by its
 * MusicBrainz id, held in a library or not, so one added later is found
 * without asking again, the ids lowercase on both sides so they join on
 * `artists.mbid`'s index; one id already held in another case keeps its own.
 * Home lists the albums added last.
 */
export const MIGRATION_047 = `
  UPDATE OR IGNORE artists SET mbid = lower(mbid) WHERE mbid <> lower(mbid);
  CREATE TABLE similar_artists (
    artist_id INTEGER NOT NULL REFERENCES artists (id) ON DELETE CASCADE,
    similar_id TEXT NOT NULL,
    score REAL NOT NULL,
    fetched_at TEXT NOT NULL,
    PRIMARY KEY (artist_id, similar_id)
  ) WITHOUT ROWID;
  CREATE INDEX albums_added ON albums (added_at);
  `
