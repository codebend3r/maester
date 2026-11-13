-- The admin's approvals, maintenance windows and the kill switch had no way in from
-- the deployed app (no route raised a window or flipped the switch, and approvals
-- were only ever written to the log), so their code was removed; git holds it. What
-- they stored goes with it: the flags and held calls, every approval, and the audit
-- columns that marked a call as waiting on one.
DROP TABLE flags;
DROP INDEX held_calls_waiting;
DROP TABLE held_calls;

DELETE FROM pending_actions WHERE kind != 'confirm';
DROP INDEX pending_actions_one_open_per_subject;
ALTER TABLE pending_actions DROP COLUMN subject;
ALTER TABLE pending_actions DROP COLUMN kind;

ALTER TABLE audit_log DROP COLUMN pending_id;
ALTER TABLE audit_log DROP COLUMN held_id;

-- A report escalated over the replacement cap waited on an approval; it is open again.
UPDATE reports SET status = 'open' WHERE status = 'escalated';
