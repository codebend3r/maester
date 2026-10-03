-- "Do this once a window", for any source: a claim per source and key. Seerr's
-- webhook deliveries (source 'seerr', keyed by type and request or issue) move
-- here from webhook_events, and a heavy remux flagged to the admin for a re-encode
-- (source 'reencode', keyed by Plex item) claims here too. Each source prunes its
-- own claims older than its window as it claims.
CREATE TABLE claims (
    source      TEXT NOT NULL,
    key         TEXT NOT NULL,
    claimed_at  TEXT NOT NULL,
    PRIMARY KEY (source, key)
);
INSERT INTO claims (source, key, claimed_at)
    SELECT source, event_key, received_at FROM webhook_events;
DROP TABLE webhook_events;
