-- Heavy remuxes the admin was told are worth re-encoding, one row per Plex item,
-- so a title streamed away from home again and again is flagged once a window
-- rather than every time a friend asks about it.
CREATE TABLE reencode_flags (
    rating_key    TEXT PRIMARY KEY,     -- the Plex item holding the heavy version
    title         TEXT NOT NULL,
    file          TEXT NOT NULL,        -- the heavy version's file, as Plex knows it
    bitrate_kbps  INTEGER NOT NULL,
    wan_plays     INTEGER NOT NULL,     -- plays away from home when it was flagged
    flagged_at    TEXT NOT NULL
);
