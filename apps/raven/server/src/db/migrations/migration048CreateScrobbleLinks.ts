/*
 * Scrobbling: each account's link to ListenBrainz or Last.fm, its token
 * or session key sealed with the server's key, and the listens waiting to
 * go out, numbered per account and service. `listened_at` is in Unix
 * seconds, as both services take it, and `next_at` in the server's
 * milliseconds; the sender finds what is due by service and time, sweeps
 * what is too old by when it began, and a removed file takes its waiting
 * listens with it.
 */
export const MIGRATION_048 = `
  CREATE TABLE scrobble_links (
    account_id TEXT NOT NULL,
    service TEXT NOT NULL,
    username TEXT NOT NULL,
    secret_cipher TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (account_id, service)
  ) WITHOUT ROWID;

  CREATE TABLE scrobble_queue (
    account_id TEXT NOT NULL,
    service TEXT NOT NULL,
    id INTEGER NOT NULL,
    media_id INTEGER NOT NULL REFERENCES media (id) ON DELETE CASCADE,
    listened_at INTEGER NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    next_at INTEGER NOT NULL,
    PRIMARY KEY (account_id, service, id)
  ) WITHOUT ROWID;
  CREATE INDEX scrobble_queue_due ON scrobble_queue (service, next_at);
  CREATE INDEX scrobble_queue_media ON scrobble_queue (media_id);
  CREATE INDEX scrobble_queue_listened ON scrobble_queue (listened_at);
  `
