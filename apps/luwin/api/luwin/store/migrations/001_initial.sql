-- luwin's whole schema, from a fresh start. The application id marks the file
-- as luwin's, so a database made before the fresh start is refused on open
-- rather than read with the wrong columns.
PRAGMA application_id = 1819637614;  -- 'luwn'

-- Who a chat account is on Plex/Seerr/Tautulli, and their tier override.
CREATE TABLE users (
    user_id           TEXT PRIMARY KEY,
    plex_email        TEXT,
    plex_username     TEXT,
    seerr_user_id     INTEGER,
    tautulli_user_id  INTEGER,
    status            TEXT NOT NULL DEFAULT 'pending',   -- pending | active | revoked
    tier_override     TEXT,                              -- friend | trusted | admin | NULL
    linked_at         TEXT,
    created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
-- One live link per Seerr user, so a request and its ready DM belong to one person.
CREATE UNIQUE INDEX users_one_live_link_per_seerr_user
    ON users (seerr_user_id)
    WHERE status != 'revoked' AND seerr_user_id IS NOT NULL;

-- Per-user conversation history, trimmed by the agent to a token budget.
CREATE TABLE conversations (
    id          INTEGER PRIMARY KEY,
    user_id     TEXT NOT NULL,
    role        TEXT NOT NULL,          -- user | assistant
    content     TEXT NOT NULL,          -- JSON: the Messages API content blocks
    tokens      INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX conversations_by_user ON conversations (user_id, id);

-- Every tool call: who asked, what ran, with what, and how it went. A call that
-- ended waiting on an approval (`pending_id`) or held for maintenance
-- (`held_id`) asked rather than acted, so daily caps never count it.
CREATE TABLE audit_log (
    id          INTEGER PRIMARY KEY,
    ts          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    user_id     TEXT,
    tool        TEXT NOT NULL,
    args        TEXT NOT NULL,          -- JSON
    result      TEXT,                   -- JSON, truncated
    ok          INTEGER NOT NULL,
    host        TEXT,                   -- the arr host touched, when any
    duration_ms INTEGER,
    pending_id  INTEGER,
    held_id     INTEGER
);
CREATE INDEX audit_log_by_ts ON audit_log (ts);
CREATE INDEX audit_log_by_tool_ts ON audit_log (tool, ts);

-- Playback reports: which copy and file a report is about, what the checks
-- found, what was decided when it was filed, and where its replacement
-- stands. A replacement is allowed from what is stored here per file (a
-- failed health check of that file, or two people reporting it), and the
-- release group is kept so repeat offenders can be counted.
--   kind:     wont_play | wrong_title | wrong_episode | cam | hardcoded_subs
--             | subtitles | audio | other
--   decision: advised | replaceable | recorded | for_admin (written once)
--   status:   open | escalated | replaced | declined (moves by compare-and-set)
CREATE TABLE reports (
    id              INTEGER PRIMARY KEY,
    ts              TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    user_id         TEXT NOT NULL,
    kind            TEXT NOT NULL,
    media_type      TEXT,
    tmdb_id         INTEGER,
    rating_key      TEXT,
    file_path       TEXT,
    host            TEXT,
    diagnosis       TEXT,               -- JSON summary
    decision        TEXT,
    seerr_issue_id  INTEGER,
    resolved_at     TEXT,
    status          TEXT NOT NULL DEFAULT 'open',
    title           TEXT NOT NULL DEFAULT '',
    is_4k           INTEGER NOT NULL DEFAULT 0,
    season          INTEGER,
    episode         INTEGER,
    file_id         INTEGER,            -- the arr's movie or episode file id
    release_group   TEXT,
    health          TEXT,               -- ok | truncated | corrupt | unreadable
    description     TEXT NOT NULL DEFAULT ''  -- in the friend's words
);
CREATE INDEX reports_by_media ON reports (tmdb_id, rating_key);
CREATE INDEX reports_by_file ON reports (host, media_type, file_id);
CREATE INDEX reports_by_issue ON reports (seerr_issue_id);

-- Things waiting on a decision: admin approvals and user confirmations.
-- `subject` is what one is about ('seerr-request:42'), so one thing waiting has
-- one open approval, whether a tool or a webhook raised it first. NULL for
-- actions that are their own subject (a confirmation, a link request).
CREATE TABLE pending_actions (
    id           INTEGER PRIMARY KEY,
    ts           TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    kind         TEXT NOT NULL,         -- confirm | approve
    action       TEXT NOT NULL,         -- tool name
    requester    TEXT NOT NULL,         -- user_id
    payload      TEXT NOT NULL,         -- JSON tool args
    summary      TEXT NOT NULL,
    decision     TEXT,                  -- approved | denied | expired | NULL while open
    decided_by   TEXT,
    decided_at   TEXT,
    expires_at   TEXT NOT NULL,
    subject      TEXT
);
CREATE INDEX pending_actions_open ON pending_actions (decision, expires_at);
CREATE UNIQUE INDEX pending_actions_one_open_per_subject
    ON pending_actions (subject) WHERE decision IS NULL AND subject IS NOT NULL;

-- "Do this once a window", for any source: a claim per source and key. Seerr's
-- webhook deliveries (source 'seerr', keyed by type and request or issue) and a
-- heavy remux flagged to the admin for a re-encode (source 'reencode', keyed by
-- Plex item). Each source prunes its own claims older than its window as it claims.
CREATE TABLE claims (
    source      TEXT NOT NULL,
    key         TEXT NOT NULL,
    claimed_at  TEXT NOT NULL,
    PRIMARY KEY (source, key)
);

-- Switches the admin flips from chat that must outlive a restart: the kill
-- switch ('kill') and a maintenance window ('maintenance'). A row means the
-- flag is up; lowering it deletes the row.
CREATE TABLE flags (
    name     TEXT PRIMARY KEY,
    message  TEXT NOT NULL DEFAULT '',  -- the reason or announcement, as the admin gave it
    set_by   TEXT,                      -- the admin's user_id
    set_at   TEXT NOT NULL
);

-- The download queues as the sweeper last saw them: how much each download
-- had left, since when it has been stuck (flagged by its arr, or not moving),
-- and when the sweeper acted on it, so "stuck for six hours" survives a
-- restart. A row goes a day after its download was last in the queue.
CREATE TABLE queue_watch (
    host         TEXT NOT NULL,
    kind         TEXT NOT NULL,     -- movie | tv
    download_id  TEXT NOT NULL,
    size_left    INTEGER NOT NULL,
    stuck_since  TEXT,              -- NULL while it moves or waits its turn
    acted_at     TEXT,              -- when it was removed or surfaced
    last_seen    TEXT NOT NULL,
    PRIMARY KEY (host, kind, download_id)
);

-- What the sweeper did about each stalled download: searched again after
-- blocklisting it, removed but not searched (the admin searches), surfaced to
-- the admin (it stalled before), or failed. The digest lists them; a title's
-- earlier re-search makes its next stall a surfacing.
CREATE TABLE stalls (
    id      INTEGER PRIMARY KEY,
    ts      TEXT NOT NULL,
    host    TEXT NOT NULL,
    kind    TEXT NOT NULL,          -- movie | tv
    item    TEXT NOT NULL,          -- the movie, or the series and its episodes
    title   TEXT NOT NULL,
    reason  TEXT NOT NULL,
    action  TEXT NOT NULL           -- researched | removed | surfaced | failed
);
CREATE INDEX stalls_by_item ON stalls (host, kind, item, ts);
CREATE INDEX stalls_by_ts ON stalls (ts);

-- Free space per volume, one sample a day, for the disk forecast. A volume is
-- keyed by its path, size and the hosts that see it (a drive added is a new
-- series); `label` is how it's named. Old samples are pruned.
CREATE TABLE space_samples (
    volume       TEXT NOT NULL,     -- '<path>|<total bytes>|<hosts>'
    day          TEXT NOT NULL,     -- YYYY-MM-DD in the server's time zone
    label        TEXT NOT NULL,     -- '/Vermithor (vermithor)'
    free_bytes   INTEGER NOT NULL,
    total_bytes  INTEGER NOT NULL,
    PRIMARY KEY (volume, day)
);

-- Calls a friend made while the server was down for maintenance, saved to
-- run once it's over, as them, at the tier they have then.
CREATE TABLE held_calls (
    id          INTEGER PRIMARY KEY,
    ts          TEXT NOT NULL,
    user_id     TEXT NOT NULL,
    tool        TEXT NOT NULL,
    args        TEXT NOT NULL,      -- JSON tool arguments
    summary     TEXT NOT NULL,
    ran_at      TEXT                -- NULL until it has run
);
CREATE INDEX held_calls_waiting ON held_calls (ran_at, id);
