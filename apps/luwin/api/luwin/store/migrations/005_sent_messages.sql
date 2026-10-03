-- DMs luwin sent about a title, so a reaction to one (a thumbs-down on
-- "Dune is ready") can be traced back to that title and copy. Rows older
-- than a month are pruned as new ones are written.
CREATE TABLE sent_messages (
    message_id   TEXT PRIMARY KEY,      -- the Discord message id
    discord_id   TEXT NOT NULL,         -- who it was sent to
    media_type   TEXT NOT NULL,
    tmdb_id      INTEGER NOT NULL,
    is_4k        INTEGER NOT NULL,
    title        TEXT NOT NULL,
    sent_at      TEXT NOT NULL
);
