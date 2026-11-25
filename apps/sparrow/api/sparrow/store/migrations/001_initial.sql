-- sparrow's whole schema, from a fresh start. The application id marks the file
-- as sparrow's, so a database made before the fresh start is refused on open
-- rather than read with the wrong columns.
PRAGMA application_id = 1936749175;  -- 'sprw'

-- Who a raven account is here: its email, where raven's owner has it, its Seerr
-- match, and its tier override. `user_id` is the raven account's id (a Supabase
-- uuid); `raven_status` and `is_owner` are refreshed from raven on every request.
CREATE TABLE users (
    user_id           TEXT PRIMARY KEY,
    email             TEXT,
    raven_status      TEXT,                              -- pending | approved | revoked
    is_owner          INTEGER NOT NULL DEFAULT 0,
    seerr_user_id     INTEGER,                           -- NULL until matched: not linked
    seerr_checked_at  TEXT,
    tier_override     TEXT,                              -- friend | trusted | admin | NULL
    last_seen_at      TEXT,
    created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
-- Whose a Seerr request is, for ready notices and the digest.
CREATE INDEX users_by_seerr_user ON users (seerr_user_id) WHERE seerr_user_id IS NOT NULL;

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

-- Every tool call: who asked, what ran, with what, and how it went.
CREATE TABLE audit_log (
    id          INTEGER PRIMARY KEY,
    ts          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    user_id     TEXT,
    tool        TEXT NOT NULL,
    args        TEXT NOT NULL,          -- JSON
    result      TEXT,                   -- JSON, truncated
    ok          INTEGER NOT NULL,
    host        TEXT,                   -- the arr host touched, when any
    duration_ms INTEGER
);
CREATE INDEX audit_log_by_ts ON audit_log (ts);
CREATE INDEX audit_log_by_tool_ts ON audit_log (tool, ts);

-- Playback reports: which copy and file a report is about, what the checks
-- found, what was decided when it was filed, and whether its file was
-- replaced. A replacement is allowed from what is stored here per file (a
-- failed health check of that file, or two people reporting it), and the
-- release group is kept so repeat offenders can be counted.
--   kind:     wont_play | wrong_title | wrong_episode | cam | hardcoded_subs
--             | subtitles | audio | other
--   decision: replaceable | recorded | for_admin (written once)
--   status:   open | replaced (moves by compare-and-set)
CREATE TABLE reports (
    id              INTEGER PRIMARY KEY,
    ts              TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    user_id         TEXT NOT NULL,
    kind            TEXT NOT NULL,
    media_type      TEXT,
    tmdb_id         INTEGER,
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
CREATE INDEX reports_by_media ON reports (tmdb_id);
CREATE INDEX reports_by_file ON reports (host, media_type, file_id);
CREATE INDEX reports_by_issue ON reports (seerr_issue_id);

-- Confirmations waiting on the requester's button.
CREATE TABLE pending_actions (
    id           INTEGER PRIMARY KEY,
    ts           TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    action       TEXT NOT NULL,         -- tool name
    requester    TEXT NOT NULL,         -- user_id
    payload      TEXT NOT NULL,         -- JSON tool args
    summary      TEXT NOT NULL,
    decision     TEXT,                  -- approved | denied | expired | NULL while open
    decided_by   TEXT,
    decided_at   TEXT,
    expires_at   TEXT NOT NULL
);
CREATE INDEX pending_actions_open ON pending_actions (decision, expires_at);

-- "Do this once a window", for any source: a claim per source and key. Seerr's
-- webhook deliveries (source 'seerr', keyed by type and request or issue), job
-- slots run (source 'job'), and the rest. Each source prunes its own claims
-- older than its window as it claims.
CREATE TABLE claims (
    source      TEXT NOT NULL,
    key         TEXT NOT NULL,
    claimed_at  TEXT NOT NULL,
    PRIMARY KEY (source, key)
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
