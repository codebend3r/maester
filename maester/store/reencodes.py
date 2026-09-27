"""Heavy remuxes the admin was told about, so each is flagged once a window."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

from maester.store.base import Database, now, stamp


class ReencodeFlags(Database):
    def flag_reencode(
        self,
        *,
        rating_key: str,
        title: str,
        file: str,
        bitrate_kbps: int,
        wan_plays: int,
        window: timedelta,
    ) -> bool:
        """Record that the admin is being told; False when they were within `window`.

        The insert (or the update of a flag older than the window) is the claim,
        so two friends asking at once can't both flag it.
        """
        cutoff = stamp(datetime.now(UTC) - window)
        with self.transaction() as conn:
            flagged = conn.execute(
                "INSERT INTO reencode_flags"
                " (rating_key, title, file, bitrate_kbps, wan_plays, flagged_at)"
                " VALUES (?, ?, ?, ?, ?, ?)"
                " ON CONFLICT (rating_key) DO UPDATE SET title = excluded.title,"
                " file = excluded.file, bitrate_kbps = excluded.bitrate_kbps,"
                " wan_plays = excluded.wan_plays, flagged_at = excluded.flagged_at"
                " WHERE reencode_flags.flagged_at < ?"
                " RETURNING rating_key",
                (rating_key, title, file, bitrate_kbps, wan_plays, now(), cutoff),
            ).fetchone()
        return flagged is not None
