/*
 * What a viewer's player sends with Report this error, for the admin to
 * work through. A report outlives its video, so media_id is no foreign
 * key; diagnostics is the JSON the player gathered. Reports are found by
 * account and time to hold back one account sending too many.
 */
export const MIGRATION_032 = `
  CREATE TABLE bug_reports (
    id INTEGER PRIMARY KEY,
    account_id TEXT NOT NULL,
    reporter_email TEXT,
    media_id INTEGER,
    title TEXT NOT NULL,
    summary TEXT NOT NULL,
    status TEXT NOT NULL,
    diagnostics TEXT NOT NULL CHECK (json_valid(diagnostics)),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX bug_reports_account ON bug_reports (account_id, created_at);
  `
