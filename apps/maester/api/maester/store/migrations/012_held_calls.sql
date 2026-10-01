-- Calls a friend made while the server was down for maintenance, saved to
-- run once it's over, as them, at the tier they have then.
CREATE TABLE held_calls (
    id          INTEGER PRIMARY KEY,
    ts          TEXT NOT NULL,
    discord_id  TEXT NOT NULL,
    tool        TEXT NOT NULL,
    args        TEXT NOT NULL,      -- JSON tool arguments
    summary     TEXT NOT NULL,
    ran_at      TEXT                -- NULL until it has run
);
CREATE INDEX held_calls_waiting ON held_calls (ran_at, id);

-- The held call a tool call ended as. Like one that asked for an approval,
-- it didn't act, so daily caps never count it.
ALTER TABLE audit_log ADD COLUMN held_id INTEGER;
