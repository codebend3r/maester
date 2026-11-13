/*
 * Coming soon's requests: one row a title, since one request downloads it
 * for everyone. `account_id` is who asked, which counts their budget;
 * `arr_id` and `command_id` are the title and the search in its Sonarr or
 * Radarr, null while the request is on its way; `status` is the last one
 * read from it.
 */
export const MIGRATION_057 = `
  CREATE TABLE download_requests (
    type TEXT NOT NULL CHECK (type IN ('movie', 'show')),
    tmdb_id TEXT NOT NULL,
    account_id TEXT NOT NULL,
    title TEXT NOT NULL,
    requested_at TEXT NOT NULL,
    arr_id INTEGER,
    command_id INTEGER,
    status TEXT NOT NULL,
    PRIMARY KEY (type, tmdb_id)
  ) WITHOUT ROWID;
  CREATE INDEX download_requests_account ON download_requests (account_id, requested_at);
  `
