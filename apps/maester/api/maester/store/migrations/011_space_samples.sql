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
