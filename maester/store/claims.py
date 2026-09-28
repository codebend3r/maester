"""Claims: something done once a window, per source and key.

A webhook delivery acted on (a repeat inside the window is acknowledged
without acting twice), or a heavy remux flagged to the admin for a
re-encode (once a month per Plex item): each claims its key under its
source first. The insert is the claim, so two at once can't both act.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

from maester.store.base import Database, now, stamp


class Claims(Database):
    def claim(self, source: str, key: str, *, window: timedelta) -> bool:
        """Claim `key` for `source`; False when it already was within `window`.

        The source's claims older than the window are dropped first, which keeps
        the table small and lets a later occurrence through. A source claims with
        one window.
        """
        cutoff = stamp(datetime.now(UTC) - window)
        with self.transaction() as conn:
            conn.execute("DELETE FROM claims WHERE source = ? AND claimed_at < ?", (source, cutoff))
            return (
                conn.execute(
                    "INSERT OR IGNORE INTO claims (source, key, claimed_at) VALUES (?, ?, ?)",
                    (source, key, now()),
                ).rowcount
                == 1
            )

    def release(self, source: str, key: str) -> None:
        """Forget a claim whose action failed, so a later occurrence can try again."""
        with self.transaction() as conn:
            conn.execute("DELETE FROM claims WHERE source = ? AND key = ?", (source, key))
