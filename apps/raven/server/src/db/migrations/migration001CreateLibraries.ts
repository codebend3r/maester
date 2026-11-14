export const MIGRATION_001 = `
  CREATE TABLE libraries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE library_paths (
    library_id INTEGER NOT NULL REFERENCES libraries (id) ON DELETE CASCADE,
    path TEXT NOT NULL,
    position INTEGER NOT NULL,
    PRIMARY KEY (library_id, path)
  );

  CREATE TABLE media (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    library_id INTEGER NOT NULL REFERENCES libraries (id) ON DELETE CASCADE,
    path TEXT NOT NULL,
    file_name TEXT NOT NULL,
    folder TEXT NOT NULL,
    title TEXT NOT NULL,
    container TEXT NOT NULL,
    size INTEGER NOT NULL,
    mtime_ms INTEGER NOT NULL,
    probed INTEGER NOT NULL DEFAULT 0,
    probe_error TEXT,
    duration REAL,
    width INTEGER,
    height INTEGER,
    video_codec TEXT,
    video_bit_depth INTEGER,
    hdr INTEGER NOT NULL DEFAULT 0,
    audio_codec TEXT,
    audio_channels INTEGER,
    bitrate INTEGER,
    thumbnail TEXT NOT NULL DEFAULT 'pending',
    added_at TEXT NOT NULL,
    UNIQUE (library_id, path)
  );

  CREATE INDEX media_library_title ON media (library_id, title COLLATE NOCASE);
  CREATE INDEX media_library_added ON media (library_id, added_at);
  CREATE INDEX media_thumbnail_pending ON media (thumbnail) WHERE thumbnail = 'pending';

  CREATE TABLE playback_progress (
    media_id INTEGER PRIMARY KEY REFERENCES media (id) ON DELETE CASCADE,
    position REAL NOT NULL,
    updated_at TEXT NOT NULL
  );
  `
