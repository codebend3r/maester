-- The download queues as the sweeper last saw them: how much each download
-- had left, since when it has been stuck (flagged by its arr, or not moving),
-- and when the sweeper acted on it, so "stuck for six hours" survives a
-- restart. A row goes when its download leaves the queue.
CREATE TABLE queue_watch (
    host         TEXT NOT NULL,
    kind         TEXT NOT NULL,     -- movie | tv
    download_id  TEXT NOT NULL,
    size_left    INTEGER NOT NULL,
    stuck_since  TEXT,              -- NULL while it moves or waits its turn
    acted_at     TEXT,              -- when it was removed or surfaced
    PRIMARY KEY (host, kind, download_id)
);

-- What the sweeper did about each stalled download: searched again after
-- blocklisting it, surfaced to the admin (it stalled before), or failed.
-- The digest lists them; a title's earlier re-search makes its next stall a
-- surfacing.
CREATE TABLE stalls (
    id      INTEGER PRIMARY KEY,
    ts      TEXT NOT NULL,
    host    TEXT NOT NULL,
    kind    TEXT NOT NULL,          -- movie | tv
    item    TEXT NOT NULL,          -- the movie, or the series and its episodes
    title   TEXT NOT NULL,
    reason  TEXT NOT NULL,
    action  TEXT NOT NULL           -- researched | surfaced | failed
);
CREATE INDEX stalls_by_item ON stalls (host, kind, item, ts);
CREATE INDEX stalls_by_ts ON stalls (ts);
