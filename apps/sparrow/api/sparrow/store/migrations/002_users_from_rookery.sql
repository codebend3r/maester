-- Users come from rookery now. `user_id` is rookery's user id; the Plex
-- fields are refreshed from every verified session, and the Seerr match when
-- it is due (`seerr_checked_at`). The link flow (status, linked_at, one live
-- link per Seerr user) is gone: a user is linked once their Plex account
-- matches a Seerr user. No chat surface has made a user since the fresh
-- start, so the table is rebuilt empty.
DROP INDEX users_one_live_link_per_seerr_user;
DROP TABLE users;

CREATE TABLE users (
    user_id           TEXT PRIMARY KEY,
    plex_id           TEXT,
    plex_email        TEXT,
    plex_username     TEXT,
    thumb             TEXT,
    seerr_user_id     INTEGER,                           -- NULL until matched: UNLINKED
    tautulli_user_id  INTEGER,
    seerr_checked_at  TEXT,
    tier_override     TEXT,                              -- friend | trusted | admin | NULL
    last_seen_at      TEXT,
    created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
-- Whose a Seerr request is, for ready notices and the digest.
CREATE INDEX users_by_seerr_user ON users (seerr_user_id) WHERE seerr_user_id IS NOT NULL;
