-- Switches the admin flips from chat that must outlive a restart: the kill
-- switch ('kill') and a maintenance window ('maintenance'). A row means the
-- flag is up; lowering it deletes the row.
CREATE TABLE flags (
    name     TEXT PRIMARY KEY,
    message  TEXT NOT NULL DEFAULT '',  -- the reason or announcement, as the admin gave it
    set_by   TEXT,                      -- the admin's discord_id
    set_at   TEXT NOT NULL
);
