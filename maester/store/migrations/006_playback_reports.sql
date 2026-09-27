-- Playback reports: which copy and file a report is about, what the checks
-- found, and what became of it. A replacement is allowed from what is stored
-- here per file (a failed health check of that file, or two people reporting
-- it), and the release group is kept so repeat offenders can be counted.
--   kind:   wont_play | wrong_title | wrong_episode | cam | hardcoded_subs
--           | subtitles | audio | other
--   action: advised | replaceable | recorded | for_admin | escalated | replaced | declined
ALTER TABLE reports ADD COLUMN title TEXT NOT NULL DEFAULT '';
ALTER TABLE reports ADD COLUMN is_4k INTEGER NOT NULL DEFAULT 0;
ALTER TABLE reports ADD COLUMN season INTEGER;
ALTER TABLE reports ADD COLUMN episode INTEGER;
ALTER TABLE reports ADD COLUMN file_id INTEGER;             -- the arr's movie or episode file id
ALTER TABLE reports ADD COLUMN release_group TEXT;
ALTER TABLE reports ADD COLUMN health TEXT;                 -- ok | truncated | corrupt | unreadable
ALTER TABLE reports ADD COLUMN description TEXT NOT NULL DEFAULT '';  -- in the friend's words
ALTER TABLE reports ADD COLUMN replaced_at TEXT;
CREATE INDEX reports_by_file ON reports (host, media_type, file_id);
CREATE INDEX reports_by_issue ON reports (seerr_issue_id);
