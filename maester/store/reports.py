"""Playback reports: who reported which file, what the checks found, what became of it."""

from __future__ import annotations

import json
import sqlite3
from dataclasses import dataclass
from typing import Any

from maester.store.base import Database, now


@dataclass(frozen=True)
class ReportRow:
    """A playback report: who reported which copy's file, what the checks found, what happened."""

    id: int
    ts: str
    discord_id: str
    kind: str
    title: str  # "Dune (2021)", "The Bear (2022) S02E07"
    media_type: str
    tmdb_id: int
    is_4k: bool
    season: int | None
    episode: int | None
    host: str
    file_id: int
    file_path: str
    release_group: str | None
    health: str | None  # the file check's verdict, when one ran
    diagnosis: dict[str, Any]
    description: str  # the problem in the friend's words
    action: str
    seerr_issue_id: int | None
    resolved_at: str | None
    replaced_at: str | None

    @property
    def version(self) -> str:
        return "4K" if self.is_4k else "1080p"


class Reports(Database):
    def add_report(
        self,
        *,
        discord_id: str,
        kind: str,
        title: str,
        media_type: str,
        tmdb_id: int,
        is_4k: bool,
        season: int | None,
        episode: int | None,
        rating_key: str | None,
        host: str,
        file_id: int,
        file_path: str,
        release_group: str | None,
        health: str | None,
        diagnosis: dict[str, Any],
        description: str,
        action: str,
    ) -> ReportRow:
        with self.transaction() as conn:
            cur = conn.execute(
                "INSERT INTO reports (ts, discord_id, kind, title, media_type, tmdb_id, is_4k,"
                " season, episode, rating_key, host, file_id, file_path, release_group, health,"
                " diagnosis, description, action) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (
                    now(),
                    discord_id,
                    kind,
                    title,
                    media_type,
                    tmdb_id,
                    int(is_4k),
                    season,
                    episode,
                    rating_key,
                    host,
                    file_id,
                    file_path,
                    release_group,
                    health,
                    json.dumps(diagnosis, default=str),
                    description,
                    action,
                ),
            )
            return self.get_report(int(cur.lastrowid))  # type: ignore[return-value]

    def get_report(self, report_id: int) -> ReportRow | None:
        with self._lock:
            r = self._conn.execute("SELECT * FROM reports WHERE id = ?", (report_id,)).fetchone()
        return self._report(r) if r else None

    def update_report(
        self, report_id: int, *, action: str | None = None, seerr_issue_id: int | None = None
    ) -> ReportRow:
        """Record what became of a report: its action, or the Seerr issue it opened."""
        with self.transaction() as conn:
            conn.execute(
                "UPDATE reports SET action = COALESCE(?, action),"
                " seerr_issue_id = COALESCE(?, seerr_issue_id) WHERE id = ?",
                (action, seerr_issue_id, report_id),
            )
            return self.get_report(report_id)  # type: ignore[return-value]

    def reports_for_file(self, host: str, media_type: str, file_id: int) -> list[ReportRow]:
        """Every report about one file, oldest first: the evidence a replacement needs."""
        with self._lock:
            rows = self._conn.execute(
                "SELECT * FROM reports WHERE host = ? AND media_type = ? AND file_id = ? ORDER BY id",
                (host, media_type, file_id),
            ).fetchall()
        return [self._report(r) for r in rows]

    def mark_file_replaced(self, host: str, media_type: str, file_id: int) -> None:
        """Every report about a file that was just deleted and searched for again."""
        with self.transaction() as conn:
            conn.execute(
                "UPDATE reports SET action = 'replaced', replaced_at = ?"
                " WHERE host = ? AND media_type = ? AND file_id = ? AND replaced_at IS NULL",
                (now(), host, media_type, file_id),
            )

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
            kind=r["kind"],
            title=r["title"],
            media_type=r["media_type"],
            tmdb_id=r["tmdb_id"],
            is_4k=bool(r["is_4k"]),
            season=r["season"],
            episode=r["episode"],
            host=r["host"],
            file_id=r["file_id"],
            file_path=r["file_path"],
            release_group=r["release_group"],
            health=r["health"],
            diagnosis=json.loads(r["diagnosis"]) if r["diagnosis"] else {},
            description=r["description"],
            action=r["action"],
            seerr_issue_id=r["seerr_issue_id"],
            resolved_at=r["resolved_at"],
            replaced_at=r["replaced_at"],
        )
