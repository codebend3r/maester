/*
 * Music: artists shared across libraries, each library's albums, and its
 * tracks keyed by the file's media row, so plays, favourites, progress,
 * tickets and downloads work on a track as they do on any file. An album
 * or an artist is found again by its MusicBrainz id when the tags carry
 * one, else by its key: a normalised name (and the library and album
 * artist for an album), or the album folder for files with no album tag.
 * Credits keep every artist of "A feat. B" and of a compilation.
 */
export const MIGRATION_042 = `
  CREATE TABLE artists (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    sort_name TEXT NOT NULL,
    name_key TEXT NOT NULL UNIQUE,
    mbid TEXT UNIQUE,
    picture TEXT,
    bio TEXT,
    fetched_at TEXT
  );

  CREATE TABLE albums (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    library_id INTEGER NOT NULL REFERENCES libraries (id) ON DELETE CASCADE,
    album_key TEXT NOT NULL,
    title TEXT NOT NULL,
    sort_title TEXT NOT NULL,
    year INTEGER,
    original_year INTEGER,
    mbid TEXT,
    release_group_mbid TEXT,
    type TEXT NOT NULL DEFAULT 'album',
    label TEXT,
    genres TEXT NOT NULL DEFAULT '[]',
    is_compilation INTEGER NOT NULL DEFAULT 0,
    credited_by_tags INTEGER NOT NULL DEFAULT 0,
    cover_source TEXT,
    cover_ref TEXT,
    replaygain_gain REAL,
    replaygain_peak REAL,
    added_at TEXT NOT NULL,
    fetched_at TEXT,
    UNIQUE (library_id, album_key)
  );
  CREATE INDEX albums_library_sort ON albums (library_id, sort_title);

  CREATE TABLE album_artists (
    album_id INTEGER NOT NULL REFERENCES albums (id) ON DELETE CASCADE,
    artist_id INTEGER NOT NULL REFERENCES artists (id) ON DELETE CASCADE,
    position INTEGER NOT NULL,
    PRIMARY KEY (album_id, position)
  ) WITHOUT ROWID;
  CREATE INDEX album_artists_artist ON album_artists (artist_id, album_id);

  CREATE TABLE tracks (
    media_id INTEGER PRIMARY KEY REFERENCES media (id) ON DELETE CASCADE,
    album_id INTEGER NOT NULL REFERENCES albums (id) ON DELETE CASCADE,
    disc INTEGER NOT NULL DEFAULT 1,
    number INTEGER,
    title TEXT NOT NULL,
    mbid TEXT,
    isrc TEXT,
    sample_rate INTEGER,
    bit_depth INTEGER,
    is_lossless INTEGER NOT NULL DEFAULT 0,
    replaygain_gain REAL,
    replaygain_peak REAL,
    lyrics_source TEXT
  );
  CREATE INDEX tracks_album ON tracks (album_id, disc, number);

  CREATE TABLE track_artists (
    media_id INTEGER NOT NULL REFERENCES media (id) ON DELETE CASCADE,
    artist_id INTEGER NOT NULL REFERENCES artists (id) ON DELETE CASCADE,
    position INTEGER NOT NULL,
    PRIMARY KEY (media_id, position)
  ) WITHOUT ROWID;
  CREATE INDEX track_artists_artist ON track_artists (artist_id, media_id);
  `
