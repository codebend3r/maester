-- Who a chat account is on Plex/Seerr/Tautulli, and their tier override.
CREATE TABLE users (
    discord_id        TEXT PRIMARY KEY,
    plex_email        TEXT,
    plex_username     TEXT,
    seerr_user_id     INTEGER,
    tautulli_user_id  INTEGER,
    status            TEXT NOT NULL DEFAULT 'pending',   -- pending | active | revoked
    tier_override     TEXT,                              -- friend | trusted | admin | NULL
    linked_at         TEXT,
    created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- Per-user conversation history, trimmed by the agent to a token budget.
CREATE TABLE conversations (
    id          INTEGER PRIMARY KEY,
    discord_id  TEXT NOT NULL,
    role        TEXT NOT NULL,          -- user | assistant
    content     TEXT NOT NULL,          -- JSON: the Messages API content blocks
    tokens      INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX conversations_by_user ON conversations (discord_id, id);

-- Every tool call: who asked, what ran, with what, and how it went.
CREATE TABLE audit_log (
    id          INTEGER PRIMARY KEY,
    ts          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    discord_id  TEXT,
    tool        TEXT NOT NULL,
    args        TEXT NOT NULL,          -- JSON
    result      TEXT,                   -- JSON, truncated
    ok          INTEGER NOT NULL,
    host        TEXT,                   -- the arr host touched, when any
    duration_ms INTEGER
);
CREATE INDEX audit_log_by_ts ON audit_log (ts);
CREATE INDEX audit_log_by_tool_ts ON audit_log (tool, ts);

-- Playback and quality reports from friends, and what was done about them.
CREATE TABLE reports (
    id              INTEGER PRIMARY KEY,
    ts              TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    discord_id      TEXT NOT NULL,
    kind            TEXT NOT NULL,      -- wont_play | lag | wrong_file | subtitles | audio | missing
    media_type      TEXT,
    tmdb_id         INTEGER,
    rating_key      TEXT,
    file_path       TEXT,
    host            TEXT,
    diagnosis       TEXT,               -- JSON summary
    action          TEXT,               -- advised | issue_opened | replaced | escalated
    seerr_issue_id  INTEGER,
    resolved_at     TEXT
);
CREATE INDEX reports_by_media ON reports (tmdb_id, rating_key);

-- Things waiting on a button press: admin approvals and user confirmations.
CREATE TABLE pending_actions (
    id           INTEGER PRIMARY KEY,
    ts           TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    kind         TEXT NOT NULL,         -- confirm | approve
    action       TEXT NOT NULL,         -- tool name
    requester    TEXT NOT NULL,         -- discord_id
    payload      TEXT NOT NULL,         -- JSON tool args
    summary      TEXT NOT NULL,
    decision     TEXT,                  -- approved | denied | expired | NULL while open
    decided_by   TEXT,
    decided_at   TEXT,
    expires_at   TEXT NOT NULL
);
CREATE INDEX pending_actions_open ON pending_actions (decision, expires_at);
