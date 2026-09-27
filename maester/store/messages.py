"""DMs about a title, remembered so a reaction to one can be traced back."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

from maester.notify import MediaRef
from maester.store.base import Database, now, stamp

# How long a DM about a title can still be reacted to.
SENT_MESSAGE_TTL = timedelta(days=30)


class SentMessages(Database):
    def remember_message(self, message_id: str, to: str, about: MediaRef) -> None:
        """Record what a DM was about, and forget ones too old to react to."""
        cutoff = stamp(datetime.now(UTC) - SENT_MESSAGE_TTL)
        with self.transaction() as conn:
            conn.execute("DELETE FROM sent_messages WHERE sent_at < ?", (cutoff,))
            conn.execute(
                "INSERT OR REPLACE INTO sent_messages"
                " (message_id, discord_id, media_type, tmdb_id, is_4k, title, sent_at)"
                " VALUES (?, ?, ?, ?, ?, ?, ?)",
                (
                    message_id,
                    to,
                    about.media_type,
                    about.tmdb_id,
                    int(about.is_4k),
                    about.title,
                    now(),
                ),
            )

    def message_about(self, message_id: str, discord_id: str) -> MediaRef | None:
        """What a DM to `discord_id` was about; None for anyone else's or an unknown one."""
        with self._lock:
            r = self._conn.execute(
                "SELECT * FROM sent_messages WHERE message_id = ? AND discord_id = ?",
                (message_id, discord_id),
            ).fetchone()
        if r is None:
            return None
        return MediaRef(r["media_type"], r["tmdb_id"], bool(r["is_4k"]), r["title"])
