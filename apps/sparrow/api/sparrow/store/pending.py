"""Pending confirmations: a destructive call waiting on its requester's Confirm or Cancel."""

from __future__ import annotations

import enum
import json
import sqlite3
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any

from sparrow.store.base import Database, now, stamp


class Decision(enum.StrEnum):
    APPROVED = "approved"
    DENIED = "denied"

    @classmethod
    def of(cls, approved: bool) -> Decision:
        return cls.APPROVED if approved else cls.DENIED


@dataclass(frozen=True)
class PendingAction:
    id: int
    action: str
    requester: str
    payload: dict[str, Any]
    summary: str
    decision: Decision | None
    expires_at: str
    decided_by: str | None = None
    ts: str = ""  # when it was raised


def _pending(r: sqlite3.Row) -> PendingAction:
    return PendingAction(
        id=r["id"],
        action=r["action"],
        requester=r["requester"],
        payload=json.loads(r["payload"]),
        summary=r["summary"],
        decision=Decision(r["decision"]) if r["decision"] else None,
        expires_at=r["expires_at"],
        decided_by=r["decided_by"],
        ts=r["ts"],
    )


class PendingActions(Database):
    def create_pending(
        self,
        *,
        action: str,
        requester: str,
        payload: dict[str, Any],
        summary: str,
        ttl: timedelta,
    ) -> PendingAction:
        expires = stamp(datetime.now(UTC) + ttl)
        with self.transaction() as conn:
            row = conn.execute(
                "INSERT INTO pending_actions"
                " (ts, action, requester, payload, summary, expires_at)"
                " VALUES (?, ?, ?, ?, ?, ?) RETURNING *",
                (now(), action, requester, json.dumps(payload, default=str), summary, expires),
            ).fetchone()
        return _pending(row)

    def get_pending(self, pending_id: int) -> PendingAction | None:
        with self._lock:
            r = self._conn.execute(
                "SELECT * FROM pending_actions WHERE id = ?", (pending_id,)
            ).fetchone()
        return _pending(r) if r else None

    def decide_pending(
        self, pending_id: int, decision: Decision, decided_by: str
    ) -> PendingAction | None:
        """Record a decision once; a second decision or an expired action is refused."""
        with self.transaction() as conn:
            r = conn.execute(
                "UPDATE pending_actions SET decision = ?, decided_by = ?, decided_at = ?"
                " WHERE id = ? AND decision IS NULL AND expires_at > ? RETURNING *",
                (decision, decided_by, now(), pending_id, now()),
            ).fetchone()
        return _pending(r) if r else None

    def reopen_pending(self, pending_id: int) -> None:
        """Undo a decision whose effect failed, so the buttons can be pressed again."""
        with self.transaction() as conn:
            conn.execute(
                "UPDATE pending_actions"
                " SET decision = NULL, decided_by = NULL, decided_at = NULL WHERE id = ?",
                (pending_id,),
            )
