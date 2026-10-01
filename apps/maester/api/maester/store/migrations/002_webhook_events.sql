-- Webhook deliveries handled recently, so a repeat of the same event is
-- acknowledged without acting twice (no second DM for one ready request).
-- Rows older than the dedupe window are pruned as new events are claimed.
CREATE TABLE webhook_events (
    source       TEXT NOT NULL,         -- seerr
    event_key    TEXT NOT NULL,         -- notification type plus the request or issue it concerns
    received_at  TEXT NOT NULL,
    PRIMARY KEY (source, event_key)
);
