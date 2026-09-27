-- What a pending action is about ('seerr-request:42'), so one thing waiting
-- has one open approval, whether a tool or a webhook raised it first. NULL for
-- actions that are their own subject (a confirmation, a link request).
ALTER TABLE pending_actions ADD COLUMN subject TEXT;
CREATE UNIQUE INDEX pending_actions_one_open_per_subject
    ON pending_actions (subject) WHERE decision IS NULL AND subject IS NOT NULL;
