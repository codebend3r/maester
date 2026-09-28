"""Webhook deliveries handled recently, so a repeat inside a window acts once."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

from maester.store.base import Database, now, stamp


class WebhookEvents(Database):
    def claim_event(self, source: str, key: str, *, window: timedelta) -> bool:
        """Record a webhook event as handled; False when it already was within `window`.

        Claims older than the window are dropped first, which keeps the table
        small and lets a later occurrence of the same event through. The
        insert is the claim, so two concurrent deliveries cannot both act.
        """
        cutoff = stamp(datetime.now(UTC) - window)
        with self.transaction() as conn:
            conn.execute("DELETE FROM webhook_events WHERE received_at < ?", (cutoff,))
            return (
                conn.execute(
                    "INSERT OR IGNORE INTO webhook_events (source, event_key, received_at)"
                    " VALUES (?, ?, ?)",
                    (source, key, now()),
                ).rowcount
                == 1
            )

    def release_event(self, source: str, key: str) -> None:
        """Forget a claim whose handling failed, so a later delivery can try again."""
        with self.transaction() as conn:
            conn.execute(
                "DELETE FROM webhook_events WHERE source = ? AND event_key = ?", (source, key)
            )
