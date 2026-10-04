"""The stalled-download sweeper's memory: the queues as last seen, and what it did.

`queue_watch` keeps, per download, how much it had left and since when it
has been stuck, so a stall is timed across sweeps and restarts. `stalls`
keeps each stalled download the sweeper acted on, for the digest and so a
title that stalls again is surfaced instead of searched a second time.
"""

from __future__ import annotations

import enum
from collections.abc import Mapping
from dataclasses import dataclass
from datetime import datetime

from luwin.store.base import Database, now, stamp


class StallAction(enum.StrEnum):
    RESEARCHED = "researched"  # blocklisted, removed and searched again
    REMOVED = "removed"  # blocklisted and removed, but the search didn't start
    SURFACED = "surfaced"  # it stalled before: left for the admin
    FAILED = "failed"  # the arr didn't answer; tried again next sweep


@dataclass(frozen=True)
class Watched:
    size_left: int
    stuck_since: str | None
    acted_at: str | None


@dataclass(frozen=True)
class StallRow:
    ts: str
    host: str
    kind: str
    item: str
    title: str
    reason: str
    action: StallAction


class Stalls(Database):
    def watched(self, host: str, kind: str) -> dict[str, Watched]:
        """Each download in a host's queue as the sweeper last saw it."""
        with self._lock:
            rows = self._conn.execute(
                "SELECT * FROM queue_watch WHERE host = ? AND kind = ?", (host, kind)
            ).fetchall()
        return {
            r["download_id"]: Watched(r["size_left"], r["stuck_since"], r["acted_at"]) for r in rows
        }

    def watch(
        self, host: str, kind: str, seen: Mapping[str, Watched], *, forget_before: datetime
    ) -> None:
        """The queue as it is now. A download it no longer lists is kept until it's gone
        unseen since `forget_before`: one missing from a single read keeps its clock."""
        at = now()
        with self.transaction() as conn:
            conn.executemany(
                "INSERT OR REPLACE INTO queue_watch"
                " (host, kind, download_id, size_left, stuck_since, acted_at, last_seen)"
                " VALUES (?, ?, ?, ?, ?, ?, ?)",
                [
                    (host, kind, download_id, w.size_left, w.stuck_since, w.acted_at, at)
                    for download_id, w in seen.items()
                ],
            )
            conn.execute(
                "DELETE FROM queue_watch WHERE host = ? AND kind = ? AND last_seen < ?",
                (host, kind, stamp(forget_before)),
            )

    def record_stall(
        self, *, host: str, kind: str, item: str, title: str, reason: str, action: StallAction
    ) -> None:
        with self.transaction() as conn:
            conn.execute(
                "INSERT INTO stalls (ts, host, kind, item, title, reason, action)"
                " VALUES (?, ?, ?, ?, ?, ?, ?)",
                (now(), host, kind, item, title, reason, action),
            )

    def researched_since(self, host: str, kind: str, item: str, since: datetime) -> str | None:
        """When the sweeper last cleared this title for a new release after a stall, if since
        `since`: searched again, or removed for the admin to search."""
        with self._lock:
            r = self._conn.execute(
                "SELECT MAX(ts) FROM stalls WHERE host = ? AND kind = ? AND item = ?"
                " AND action IN (?, ?) AND ts >= ?",
                (host, kind, item, StallAction.RESEARCHED, StallAction.REMOVED, stamp(since)),
            ).fetchone()
        return r[0]

    def stalls_since(self, since: datetime) -> list[StallRow]:
        """What the sweeper did since `since`, oldest first."""
        with self._lock:
            rows = self._conn.execute(
                "SELECT * FROM stalls WHERE ts >= ? ORDER BY id", (stamp(since),)
            ).fetchall()
        return [
            StallRow(
                r["ts"],
                r["host"],
                r["kind"],
                r["item"],
                r["title"],
                r["reason"],
                StallAction(r["action"]),
            )
            for r in rows
        ]
