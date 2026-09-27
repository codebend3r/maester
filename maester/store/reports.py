"""Playback reports: who reported which file, what the checks found, what became of it.

A report's `decision` is written once, when it is filed. Its `status` only
moves through `move_report`, a compare-and-set: the move happens only from
the statuses it names, so two presses can't both escalate one report and a
stale read can't undo a newer move. Which moves exist is the playback
flow's (`maester/playback/reports.py`).
"""

from __future__ import annotations

import json
import sqlite3
from collections.abc import Iterable
from dataclasses import dataclass
from typing import Any

from maester.media import Copy, Decision, ReportKind, ReportStatus
from maester.store.base import Database, now


@dataclass(frozen=True)
class ReportRow:
    """A playback report: who reported which copy's file, what the checks found, what happened."""

    id: int
    ts: str
    discord_id: str
    kind: ReportKind
    copy: Copy
    title: str  # "Dune (2021)", "The Bear (2022) S02E07"
    host: str
    file_id: int
    file_path: str
    release_group: str | None
    health: str | None  # the file check's verdict, when one ran
    diagnosis: dict[str, Any]
    description: str  # the problem in the friend's words
    decision: Decision
    status: ReportStatus
    seerr_issue_id: int | None
    resolved_at: str | None


class Reports(Database):
    def add_report(
        self,
        *,
        discord_id: str,
        kind: ReportKind,
        copy: Copy,
        title: str,
        rating_key: str | None,
        host: str,
        file_id: int,
        file_path: str,
        release_group: str | None,
        health: str | None,
        diagnosis: dict[str, Any],
        description: str,
        decision: Decision,
    ) -> ReportRow:
        with self.transaction() as conn:
            cur = conn.execute(
                "INSERT INTO reports (ts, discord_id, kind, title, media_type, tmdb_id, is_4k,"
                " season, episode, rating_key, host, file_id, file_path, release_group,"
                " health, diagnosis, description, decision)"
                " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (
                    now(),
                    discord_id,
                    kind,
                    title,
                    copy.media_type,
                    copy.tmdb_id,
                    int(copy.is_4k),
                    copy.season,
                    copy.episode,
                    rating_key,
                    host,
                    file_id,
                    file_path,
                    release_group,
                    health,
                    json.dumps(diagnosis, default=str),
                    description,
                    decision,
                ),
            )
            return self.get_report(int(cur.lastrowid))  # type: ignore[return-value]

    def get_report(self, report_id: int) -> ReportRow | None:
        with self._lock:
            r = self._conn.execute("SELECT * FROM reports WHERE id = ?", (report_id,)).fetchone()
        return self._report(r) if r else None

    def set_report_issue(self, report_id: int, seerr_issue_id: int) -> ReportRow:
        """The Seerr issue a report opened."""
        with self.transaction() as conn:
            conn.execute(
                "UPDATE reports SET seerr_issue_id = ? WHERE id = ?", (seerr_issue_id, report_id)
            )
            return self.get_report(report_id)  # type: ignore[return-value]

    def move_report(
        self, report_id: int, from_: Iterable[ReportStatus], to: ReportStatus
    ) -> ReportRow | None:
        """Move a report's status to `to` only from one of `from_`; None when it wasn't there."""
        start = list(from_)
        marks = ", ".join("?" for _ in start)
        with self.transaction() as conn:
            moved = conn.execute(
                f"UPDATE reports SET status = ? WHERE id = ? AND status IN ({marks}) RETURNING id",
                (to, report_id, *start),
            ).fetchone()
            return self.get_report(report_id) if moved else None

    def reports_for_file(self, host: str, media_type: str, file_id: int) -> list[ReportRow]:
        """Every report about one file, oldest first: the evidence a replacement needs."""
        with self._lock:
            rows = self._conn.execute(
                "SELECT * FROM reports WHERE host = ? AND media_type = ? AND file_id = ? ORDER BY id",
                (host, media_type, file_id),
            ).fetchall()
        return [self._report(r) for r in rows]

    def set_issue_resolved(self, seerr_issue_id: int, resolved: bool) -> list[ReportRow]:
        """Follow a Seerr issue being resolved or reopened; returns the reports that changed."""
        with self.transaction() as conn:
            changed = conn.execute(
                "UPDATE reports SET resolved_at = ?"
                " WHERE seerr_issue_id = ? AND (resolved_at IS NULL) = ? RETURNING id",
                (now() if resolved else None, seerr_issue_id, int(resolved)),
            ).fetchall()
            return [self.get_report(r["id"]) for r in changed]  # type: ignore[misc]

    @staticmethod
    def _report(r: sqlite3.Row) -> ReportRow:
        return ReportRow(
            id=r["id"],
            ts=r["ts"],
            discord_id=r["discord_id"],
            kind=ReportKind(r["kind"]),
            copy=Copy(r["media_type"], r["tmdb_id"], bool(r["is_4k"]), r["season"], r["episode"]),
            title=r["title"],
            host=r["host"],
            file_id=r["file_id"],
            file_path=r["file_path"],
            release_group=r["release_group"],
            health=r["health"],
            diagnosis=json.loads(r["diagnosis"]) if r["diagnosis"] else {},
            description=r["description"],
            decision=Decision(r["decision"]),
            status=ReportStatus(r["status"]),
            seerr_issue_id=r["seerr_issue_id"],
            resolved_at=r["resolved_at"],
        )
