/*
 * Each account's notifications: every toast its screens showed, logged as
 * it appears. The id grows as they come, so it is the log's order.
 */
export const MIGRATION_055 = `
  CREATE TABLE notifications (
    id INTEGER PRIMARY KEY,
    account_id TEXT NOT NULL,
    message TEXT NOT NULL,
    tone TEXT NOT NULL CHECK (tone IN ('success', 'info', 'failure')),
    at TEXT NOT NULL
  );
  CREATE INDEX notifications_account ON notifications (account_id, id);
  `
