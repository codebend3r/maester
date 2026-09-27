-- Webhook deliveries already handled, so a repeat of the same event is
-- acknowledged without acting twice (no second DM for one ready request).
CREATE TABLE webhook_events (
    source       TEXT NOT NULL,         -- seerr
    event_key    TEXT NOT NULL,         -- notification type plus the request or issue it concerns
    received_at  TEXT NOT NULL,
    PRIMARY KEY (source, event_key)
);
