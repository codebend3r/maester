-- What a pending action is about ('seerr-request:42'), so one thing waiting
-- has one open approval, whether a tool or a webhook raised it first. NULL for
-- actions that are their own subject (a confirmation, a link request).
ALTER TABLE pending_actions ADD COLUMN subject TEXT;
CREATE UNIQUE INDEX pending_actions_one_open_per_subject
    ON pending_actions (subject) WHERE decision IS NULL AND subject IS NOT NULL;

-- A 4K request's approval was decided by `decide_4k_request`, now `decide_request`
-- for either version. Open ones carry over, about their request, so their
-- buttons still work and nothing raises a second approval for them.
UPDATE pending_actions
SET action = 'decide_request',
    payload = json_set(payload, '$.version', '4K'),
    subject = 'seerr-request:' || json_extract(payload, '$.request_id')
WHERE action = 'decide_4k_request' AND decision IS NULL
  AND id IN (
    SELECT MIN(id) FROM pending_actions
    WHERE action = 'decide_4k_request' AND decision IS NULL
    GROUP BY json_extract(payload, '$.request_id')
  );
