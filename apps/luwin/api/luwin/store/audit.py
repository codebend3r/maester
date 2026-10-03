"""The audit log: every tool call, who made it, what ran, and how it went."""

from __future__ import annotations

import json
import sqlite3
from dataclasses import dataclass
from datetime import datetime
from typing import Any

from luwin.store.base import Database, now, stamp

RESULT_MAX_CHARS = 4000


@dataclass(frozen=True)
class AuditRow:
    id: int
    ts: str
    user_id: str | None
    tool: str
    args: dict[str, Any]
    result: Any
    ok: bool
    host: str | None
    duration_ms: int | None
    pending_id: int | None = None
    held_id: int | None = None


class AuditLog(Database):
    def audit(
        self,
        *,
        user_id: str | None,
        tool: str,
        args: dict[str, Any],
        result: Any,
        ok: bool,
        host: str | None = None,
        duration_ms: int | None = None,
        pending_id: int | None = None,
        held_id: int | None = None,
    ) -> int:
        """Record one tool call. Called by the tool runner, never by tools.

        `pending_id` marks a call that ended waiting on an admin approval, and
        `held_id` one held for a maintenance window.
        """
        result_json = json.dumps(result, default=str)
        if len(result_json) > RESULT_MAX_CHARS:
            # Keep the row readable: a cut-off JSON string would fail to parse
            # on the way back out, so store a marker plus a preview instead.
            result_json = json.dumps({"truncated": True, "preview": result_json[:RESULT_MAX_CHARS]})
        with self.transaction() as conn:
            cur = conn.execute(
                "INSERT INTO audit_log (ts, user_id, tool, args, result, ok, host,"
                " duration_ms, pending_id, held_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (
                    now(),
                    user_id,
                    tool,
                    json.dumps(args, default=str),
                    result_json,
                    int(ok),
                    host,
                    duration_ms,
                    pending_id,
                    held_id,
                ),
            )
            return int(cur.lastrowid)

    def audit_recent(self, limit: int = 20, *, tool: str | None = None) -> list[AuditRow]:
        sql = "SELECT * FROM audit_log"
        params: tuple[Any, ...] = ()
        if tool:
            sql += " WHERE tool = ?"
            params = (tool,)
        sql += " ORDER BY id DESC LIMIT ?"
        with self._lock:
            rows = self._conn.execute(sql, (*params, limit)).fetchall()
        return [self._row(r) for r in rows]

    @staticmethod
    def _row(r: sqlite3.Row) -> AuditRow:
        return AuditRow(
            id=r["id"],
            ts=r["ts"],
            user_id=r["user_id"],
            tool=r["tool"],
            args=json.loads(r["args"]),
            result=json.loads(r["result"]) if r["result"] else None,
            ok=bool(r["ok"]),
            host=r["host"],
            duration_ms=r["duration_ms"],
            pending_id=r["pending_id"],
            held_id=r["held_id"],
        )

    def acted_since(self, tools: tuple[str, ...], since: datetime) -> list[AuditRow]:
        """The calls of `tools` that acted since `since`, oldest first: not refused or
        failed, and not only asking for an approval or held for maintenance."""
        marks = ", ".join("?" for _ in tools)
        with self._lock:
            rows = self._conn.execute(
                f"SELECT * FROM audit_log WHERE tool IN ({marks}) AND ok = 1"
                " AND pending_id IS NULL AND held_id IS NULL AND ts >= ? ORDER BY id",
                (*tools, stamp(since)),
            ).fetchall()
        return [self._row(r) for r in rows]

    def audit_count_since(self, tool: str, since: datetime) -> int:
        """How many times `tool` acted since `since`; used by daily caps.

        A call that only asked for an approval, or was held for maintenance, did
        not act, so it is left out.
        """
        with self._lock:
            row = self._conn.execute(
                "SELECT COUNT(*) FROM audit_log WHERE tool = ? AND ok = 1"
                " AND pending_id IS NULL AND held_id IS NULL AND ts >= ?",
                (tool, stamp(since)),
            ).fetchone()
        return int(row[0])
