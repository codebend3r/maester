-- The pending action (an admin approval) a tool call ended up waiting on.
-- Such a call asked rather than acted, so daily caps never count it.
ALTER TABLE audit_log ADD COLUMN pending_id INTEGER;
