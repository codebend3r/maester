"""Playback reports: who reported which file, what the checks found, what became of it.

A report's `decision` is written once, when it is filed. Its `status` only
moves from `open` to `replaced`, through `mark_replaced`, which touches only
open reports, so a stale read can't move one back.
"""

from __future__ import annotations

import json
import sqlite3
from dataclasses import dataclass
from datetime import datetime
from typing import Any

from sparrow.media import Copy, Decision, MediaType, ReportKind, ReportStatus
from sparrow.store.base import Database, now, stamp


@dataclass(frozen=True)
class ReportRow:
    """A playback report: who reported which copy's file, what the checks found, what happened."""

    id: int
    ts: str
    user_id: str
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
        user_id: str,
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
            row = conn.execute(
                "INSERT INTO reports (ts, user_id, kind, title, media_type, tmdb_id, is_4k,"
                " season, episode, rating_key, host, file_id, file_path, release_group,"
                " health, diagnosis, description, decision)"
                " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *",
                (
                    now(),
                    user_id,
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
            ).fetchone()
        return self._report(row)

    def get_report(self, report_id: int) -> ReportRow | None:
        with self._lock:
            r = self._conn.execute("SELECT * FROM reports WHERE id = ?", (report_id,)).fetchone()
        return self._report(r) if r else None

    def set_report_issue(self, report_id: int, seerr_issue_id: int) -> ReportRow:
        """The Seerr issue a report opened."""
        with self.transaction() as conn:
            row = conn.execute(
                "UPDATE reports SET seerr_issue_id = ? WHERE id = ? RETURNING *",
                (seerr_issue_id, report_id),
            ).fetchone()
        if row is None:
            raise LookupError(f"no report {report_id}")
        return self._report(row)

    def mark_replaced(self, host: str, media_type: MediaType, file_id: int) -> None:
        """Every open report of one file marked replaced at once, since its new copy settles
        them all."""
        with self.transaction() as conn:
            conn.execute(
                "UPDATE reports SET status = ?"
                " WHERE host = ? AND media_type = ? AND file_id = ? AND status = ?",
                (ReportStatus.REPLACED, host, media_type, file_id, ReportStatus.OPEN),
            )

    def reports_for_file(self, host: str, media_type: MediaType, file_id: int) -> list[ReportRow]:
        """Every report about one file, oldest first: the evidence a replacement needs."""
        with self._lock:
            rows = self._conn.execute(
                "SELECT * FROM reports WHERE host = ? AND media_type = ? AND file_id = ? ORDER BY id",
                (host, media_type, file_id),
            ).fetchall()
        return [self._report(r) for r in rows]

    def file_reports_since(self, since: datetime) -> list[ReportRow]:
        """Reports since `since` that count against their file: all but those a player
        limit explained, where the file was fine."""
        with self._lock:
            rows = self._conn.execute(
                "SELECT * FROM reports WHERE ts >= ? AND decision != ? ORDER BY id",
                (stamp(since), Decision.ADVISED),
            ).fetchall()
        return [self._report(r) for r in rows]

    def set_issue_resolved(self, seerr_issue_id: int, resolved: bool) -> list[ReportRow]:
        """Follow a Seerr issue being resolved or reopened; returns the reports that changed."""
        with self.transaction() as conn:
            changed = conn.execute(
                "UPDATE reports SET resolved_at = ?"
                " WHERE seerr_issue_id = ? AND (resolved_at IS NULL) = ? RETURNING *",
                (now() if resolved else None, seerr_issue_id, int(resolved)),
            ).fetchall()
        return [self._report(r) for r in changed]

    @staticmethod
    def _report(r: sqlite3.Row) -> ReportRow:
        return ReportRow(
            id=r["id"],
            ts=r["ts"],
            user_id=r["user_id"],
            kind=ReportKind(r["kind"]),
            copy=Copy(
                MediaType(r["media_type"]),
                r["tmdb_id"],
                bool(r["is_4k"]),
                r["season"],
                r["episode"],
            ),
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
