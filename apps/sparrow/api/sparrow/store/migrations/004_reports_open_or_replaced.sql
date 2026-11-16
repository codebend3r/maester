-- Only the admin's approval flow, removed in 003, ever declined a report's replacement, so
-- a report is now open or replaced. Any declined one left is open again.
UPDATE reports SET status = 'open' WHERE status = 'declined';
