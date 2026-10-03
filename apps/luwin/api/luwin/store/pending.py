"""Pending actions: confirmations and approvals waiting on a button press.

An approval can name its subject (the Seerr request it decides), and then at
most one about that subject is open at a time: whoever raises it second gets
the open one back instead of a duplicate (`create_pending_once`). One that
expired is marked so when a new one is raised, which frees its subject.
"""

from __future__ import annotations

import json
import sqlite3
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any

from maester.store.base import Database, now, stamp


@dataclass(frozen=True)
class PendingAction:
    id: int
    kind: str
    action: str
    requester: str
    payload: dict[str, Any]
    summary: str
    decision: str | None
    expires_at: str
    decided_by: str | None = None
    ts: str = ""  # when it was raised
    subject: str | None = None


class PendingActions(Database):
    def create_pending(
        self,
        *,
        kind: str,
        action: str,
        requester: str,
        payload: dict[str, Any],
        summary: str,
        ttl: timedelta,
        subject: str | None = None,
    ) -> PendingAction:
        expires = stamp(datetime.now(UTC) + ttl)
        with self.transaction() as conn:
            cur = conn.execute(
                "INSERT INTO pending_actions"
                " (ts, kind, action, requester, payload, summary, expires_at, subject)"
                " VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                (
                    now(),
                    kind,
                    action,
                    requester,
                    json.dumps(payload, default=str),
                    summary,
                    expires,
                    subject,
                ),
            )
            return self.get_pending(int(cur.lastrowid))  # type: ignore[return-value]

    def create_pending_once(
        self,
        *,
        subject: str,
        kind: str,
        action: str,
        requester: str,
        payload: dict[str, Any],
        summary: str,
        ttl: timedelta,
    ) -> tuple[PendingAction, bool]:
        """The open action about `subject`, raising it when there is none; True when it's new."""
        with self.transaction() as conn:
            conn.execute(
                "UPDATE pending_actions SET decision = 'expired'"
                " WHERE subject = ? AND decision IS NULL AND expires_at <= ?",
                (subject, now()),
            )
            if open_ := self.pending_about(subject):
                return open_, False
            created = self.create_pending(
                kind=kind,
                action=action,
                requester=requester,
                payload=payload,
                summary=summary,
                ttl=ttl,
                subject=subject,
            )
        return created, True

    def pending_about(self, subject: str) -> PendingAction | None:
        """The open action about `subject`, if any."""
        with self._lock:
            r = self._conn.execute(
                "SELECT id FROM pending_actions"
                " WHERE subject = ? AND decision IS NULL AND expires_at > ?",
                (subject, now()),
            ).fetchone()
        return self.get_pending(r["id"]) if r else None

    def get_pending(self, pending_id: int) -> PendingAction | None:
        with self._lock:
            r = self._conn.execute(
                "SELECT * FROM pending_actions WHERE id = ?", (pending_id,)
            ).fetchone()
        if r is None:
            return None
        return PendingAction(
            id=r["id"],
            kind=r["kind"],
            action=r["action"],
            requester=r["requester"],
            payload=json.loads(r["payload"]),
            summary=r["summary"],
            decision=r["decision"],
            expires_at=r["expires_at"],
            decided_by=r["decided_by"],
            ts=r["ts"],
            subject=r["subject"],
        )

    def decide_pending(
        self, pending_id: int, decision: str, decided_by: str
    ) -> PendingAction | None:
        """Record a decision once; a second decision or an expired action is refused."""
        with self.transaction() as conn:
            updated = conn.execute(
                "UPDATE pending_actions SET decision = ?, decided_by = ?, decided_at = ?"
                " WHERE id = ? AND decision IS NULL AND expires_at > ?",
                (decision, decided_by, now(), pending_id, now()),
            ).rowcount
        return self.get_pending(pending_id) if updated else None

    def reopen_pending(self, pending_id: int) -> bool:
        """Undo a decision whose effect failed, so the buttons can be pressed again.

        False when another action about the same subject was raised meanwhile:
        that one stands, and this one stays closed.
        """
        try:
            with self.transaction() as conn:
                conn.execute(
                    "UPDATE pending_actions"
                    " SET decision = NULL, decided_by = NULL, decided_at = NULL WHERE id = ?",
                    (pending_id,),
                )
        except sqlite3.IntegrityError:
            return False
        return True

    def open_pending(
        self, kind: str | None = None, *, action: str | None = None, requester: str | None = None
    ) -> list[PendingAction]:
        sql = "SELECT id FROM pending_actions WHERE decision IS NULL AND expires_at > ?"
        params: tuple[Any, ...] = (now(),)
        for column, value in (("kind", kind), ("action", action), ("requester", requester)):
            if value:
                sql += f" AND {column} = ?"
                params += (value,)
        with self._lock:
            ids = [r["id"] for r in self._conn.execute(sql + " ORDER BY id", params).fetchall()]
        return [p for p in (self.get_pending(i) for i in ids) if p]
