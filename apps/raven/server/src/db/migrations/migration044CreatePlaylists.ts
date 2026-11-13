/*
 * Each account's playlists, its favourite albums and artists, and what
 * LRCLIB said of a track's lyrics, asked once per track. A playlist's
 * tracks are kept by position, so the same track may come twice; the
 * media and album indexes let a removed file, album or artist cascade by
 * key. An audiobook read before chapters were kept stored none, so it
 * reads them again on its next play.
 */
export const MIGRATION_044 = `
  CREATE TABLE playlists (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id TEXT NOT NULL,
    name TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX playlists_account ON playlists (account_id, updated_at);

  CREATE TABLE playlist_tracks (
    playlist_id INTEGER NOT NULL REFERENCES playlists (id) ON DELETE CASCADE,
    position INTEGER NOT NULL,
    media_id INTEGER NOT NULL REFERENCES media (id) ON DELETE CASCADE,
    PRIMARY KEY (playlist_id, position)
  ) WITHOUT ROWID;
  CREATE INDEX playlist_tracks_media ON playlist_tracks (media_id);

  CREATE TABLE album_favourites (
    account_id TEXT NOT NULL,
    album_id INTEGER NOT NULL REFERENCES albums (id) ON DELETE CASCADE,
    added_at TEXT NOT NULL,
    PRIMARY KEY (account_id, album_id)
  ) WITHOUT ROWID;
  CREATE INDEX album_favourites_album ON album_favourites (album_id);

  CREATE TABLE artist_favourites (
    account_id TEXT NOT NULL,
    artist_id INTEGER NOT NULL REFERENCES artists (id) ON DELETE CASCADE,
    added_at TEXT NOT NULL,
    PRIMARY KEY (account_id, artist_id)
  ) WITHOUT ROWID;
  CREATE INDEX artist_favourites_artist ON artist_favourites (artist_id);

  CREATE TABLE track_lyrics (
    media_id INTEGER PRIMARY KEY REFERENCES media (id) ON DELETE CASCADE,
    synced TEXT,
    plain TEXT,
    fetched_at TEXT NOT NULL
  );

  UPDATE media SET chapters = NULL
   WHERE chapters = '[]'
     AND library_id IN (SELECT id FROM libraries WHERE kind = 'audiobooks');
  `
