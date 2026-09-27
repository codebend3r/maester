"""SQLite persistence: users, conversations, the audit log, reports, pending actions, webhook events.

One file on `/data`, schema managed by numbered SQL migrations under
`migrations/`. Nothing here is a source of truth for media; Seerr and the
arrs are. This is the bot's own memory of who asked for what and what it did.

Access is synchronous sqlite3 behind a lock. Every call is a handful of
rows, so it stays off the event loop for microseconds, and the lock keeps
the Discord and web sides from interleaving statements on one connection.
"""

from __future__ import annotations

import json
import sqlite3
import threading
from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from enum import StrEnum
from pathlib import Path
from typing import Any

MIGRATIONS_DIR = Path(__file__).parent / "migrations"
RESULT_MAX_CHARS = 4000


def _now() -> str:
    return datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"


@dataclass(frozen=True)
class AuditRow:
    id: int
    ts: str
    discord_id: str | None
    tool: str
    args: dict[str, Any]
    result: Any
    ok: bool
    host: str | None
    duration_ms: int | None


class LinkStatus(StrEnum):
    PENDING = "pending"
    ACTIVE = "active"
    REVOKED = "revoked"


@dataclass(frozen=True)
class UserRow:
    discord_id: str
    plex_email: str | None
    plex_username: str | None
    seerr_user_id: int | None
    tautulli_user_id: int | None
    status: LinkStatus
    tier_override: str | None


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


class Store:
    def __init__(self, path: str | Path):
        self.path = str(path)
        if self.path != ":memory:":
            Path(self.path).parent.mkdir(parents=True, exist_ok=True)
        self._conn = sqlite3.connect(self.path, check_same_thread=False, isolation_level=None)
        self._conn.row_factory = sqlite3.Row
        self._conn.execute("PRAGMA journal_mode=WAL")
        self._conn.execute("PRAGMA foreign_keys=ON")
        self._lock = threading.RLock()
        self._in_tx = False
        self.migrate()

    def close(self) -> None:
        self._conn.close()

    @contextmanager
    def transaction(self) -> Iterator[sqlite3.Connection]:
        """One atomic unit. Store calls made inside it join it instead of committing alone."""
        with self._lock:
            outer = not self._in_tx
            if outer:
                self._conn.execute("BEGIN")
                self._in_tx = True
            try:
                yield self._conn
            except BaseException:
                if outer:
                    self._conn.execute("ROLLBACK")
                raise
            else:
                if outer:
                    self._conn.execute("COMMIT")
            finally:
                if outer:
                    self._in_tx = False

    # -- migrations -------------------------------------------------------

    def migrate(self) -> list[str]:
        """Apply every migration newer than the schema version; returns what ran."""
        with self._lock:
            self._conn.execute(
                "CREATE TABLE IF NOT EXISTS schema_version (version INTEGER PRIMARY KEY)"
            )
            current = self._conn.execute(
                "SELECT COALESCE(MAX(version), 0) FROM schema_version"
            ).fetchone()[0]
            applied = []
            for path in sorted(MIGRATIONS_DIR.glob("*.sql")):
                version = int(path.name.split("_", 1)[0])
                if version <= current:
                    continue
                # executescript commits any open transaction before it runs,
                # so the migration carries its own BEGIN/COMMIT: the schema
                # and the version row land together or not at all.
                self._conn.executescript(
                    "BEGIN;\n"
                    f"{path.read_text()}\n"
                    f"INSERT INTO schema_version (version) VALUES ({version});\n"
                    "COMMIT;"
                )
                applied.append(path.name)
            return applied

    # -- audit ------------------------------------------------------------

    def audit(
        self,
        *,
        discord_id: str | None,
        tool: str,
        args: dict[str, Any],
        result: Any,
        ok: bool,
        host: str | None = None,
        duration_ms: int | None = None,
    ) -> int:
        """Record one tool call. Called by the tool runner, never by tools."""
        result_json = json.dumps(result, default=str)
        if len(result_json) > RESULT_MAX_CHARS:
            # Keep the row readable: a cut-off JSON string would fail to parse
            # on the way back out, so store a marker plus a preview instead.
            result_json = json.dumps({"truncated": True, "preview": result_json[:RESULT_MAX_CHARS]})
        with self.transaction() as conn:
            cur = conn.execute(
                "INSERT INTO audit_log (ts, discord_id, tool, args, result, ok, host, duration_ms)"
                " VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                (
                    _now(),
                    discord_id,
                    tool,
                    json.dumps(args, default=str),
                    result_json,
                    int(ok),
                    host,
                    duration_ms,
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
        return [
            AuditRow(
                id=r["id"],
                ts=r["ts"],
                discord_id=r["discord_id"],
                tool=r["tool"],
                args=json.loads(r["args"]),
                result=json.loads(r["result"]) if r["result"] else None,
                ok=bool(r["ok"]),
                host=r["host"],
                duration_ms=r["duration_ms"],
            )
            for r in rows
        ]

    def audit_count_since(self, tool: str, since: datetime) -> int:
        """How many successful calls of `tool` since `since`; used by daily caps."""
        with self._lock:
            row = self._conn.execute(
                "SELECT COUNT(*) FROM audit_log WHERE tool = ? AND ok = 1 AND ts >= ?",
                (tool, since.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"),
            ).fetchone()
        return int(row[0])

    # -- users ------------------------------------------------------------

    def upsert_user(self, discord_id: str, **fields: Any) -> UserRow:
        allowed = {
            "plex_email",
            "plex_username",
            "seerr_user_id",
            "tautulli_user_id",
            "status",
            "tier_override",
            "linked_at",
        }
        unknown = set(fields) - allowed
        if unknown:
            raise ValueError(f"unknown user fields: {sorted(unknown)}")
        with self.transaction() as conn:
            conn.execute("INSERT OR IGNORE INTO users (discord_id) VALUES (?)", (discord_id,))
            if fields:
                assignments = ", ".join(f"{k} = ?" for k in fields)
                conn.execute(
                    f"UPDATE users SET {assignments} WHERE discord_id = ?",
                    (*fields.values(), discord_id),
                )
        return self.get_user(discord_id)  # type: ignore[return-value]

    def get_user(self, discord_id: str) -> UserRow | None:
        with self._lock:
            r = self._conn.execute(
                "SELECT * FROM users WHERE discord_id = ?", (discord_id,)
            ).fetchone()
        return self._user(r)

    def user_by_seerr_id(self, seerr_user_id: int) -> UserRow | None:
        """The live (pending or active) link to a Seerr user; linking allows one at a time."""
        with self._lock:
            r = self._conn.execute(
                "SELECT * FROM users WHERE seerr_user_id = ? AND status != ?",
                (seerr_user_id, LinkStatus.REVOKED),
            ).fetchone()
        return self._user(r)

    @staticmethod
    def _user(r: sqlite3.Row | None) -> UserRow | None:
        if r is None:
            return None
        return UserRow(
            discord_id=r["discord_id"],
            plex_email=r["plex_email"],
            plex_username=r["plex_username"],
            seerr_user_id=r["seerr_user_id"],
            tautulli_user_id=r["tautulli_user_id"],
            status=LinkStatus(r["status"]),
            tier_override=r["tier_override"],
        )

    # -- conversations ----------------------------------------------------

    def append_message(self, discord_id: str, role: str, content: Any, tokens: int = 0) -> int:
        with self.transaction() as conn:
            cur = conn.execute(
                "INSERT INTO conversations (discord_id, role, content, tokens, created_at) VALUES (?, ?, ?, ?, ?)",
                (discord_id, role, json.dumps(content, default=str), tokens, _now()),
            )
            return int(cur.lastrowid)

    def recent_messages(
        self, discord_id: str, *, max_tokens: int, since: datetime | None = None
    ) -> list[dict[str, Any]]:
        """The newest messages whose token sum fits the budget, oldest first.

        Messages older than `since` are left out, which is how an idle
        conversation starts fresh. The window is then trimmed to begin on a
        plain user message: a `tool_result` without the `tool_use` it answers
        is rejected by the API, so a cut inside a tool exchange is never sent.
        """
        sql = "SELECT role, content, tokens FROM conversations WHERE discord_id = ?"
        params: tuple[Any, ...] = (discord_id,)
        if since is not None:
            sql += " AND created_at >= ?"
            params += (since.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z",)
        with self._lock:
            rows = self._conn.execute(sql + " ORDER BY id DESC LIMIT 200", params).fetchall()
        kept: list[dict[str, Any]] = []
        budget = max_tokens
        for r in rows:
            budget -= r["tokens"]
            if budget < 0 and kept:
                break
            kept.append({"role": r["role"], "content": json.loads(r["content"])})
        kept.reverse()
        while kept and not (kept[0]["role"] == "user" and isinstance(kept[0]["content"], str)):
            kept.pop(0)
        return kept

    def clear_messages(self, discord_id: str) -> int:
        with self.transaction() as conn:
            return conn.execute(
                "DELETE FROM conversations WHERE discord_id = ?", (discord_id,)
            ).rowcount

    # -- pending actions --------------------------------------------------

    def create_pending(
        self,
        *,
        kind: str,
        action: str,
        requester: str,
        payload: dict[str, Any],
        summary: str,
        ttl: timedelta,
    ) -> PendingAction:
        expires = (datetime.now(UTC) + ttl).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"
        with self.transaction() as conn:
            cur = conn.execute(
                "INSERT INTO pending_actions (ts, kind, action, requester, payload, summary, expires_at)"
                " VALUES (?, ?, ?, ?, ?, ?, ?)",
                (
                    _now(),
                    kind,
                    action,
                    requester,
                    json.dumps(payload, default=str),
                    summary,
                    expires,
                ),
            )
            return self.get_pending(int(cur.lastrowid))  # type: ignore[return-value]

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
        )

    def decide_pending(
        self, pending_id: int, decision: str, decided_by: str
    ) -> PendingAction | None:
        """Record a decision once; a second decision or an expired action is refused."""
        with self.transaction() as conn:
            updated = conn.execute(
                "UPDATE pending_actions SET decision = ?, decided_by = ?, decided_at = ?"
                " WHERE id = ? AND decision IS NULL AND expires_at > ?",
                (decision, decided_by, _now(), pending_id, _now()),
            ).rowcount
        return self.get_pending(pending_id) if updated else None

    def reopen_pending(self, pending_id: int) -> None:
        """Undo a decision whose effect failed, so the buttons can be pressed again."""
        with self.transaction() as conn:
            conn.execute(
                "UPDATE pending_actions SET decision = NULL, decided_by = NULL, decided_at = NULL"
                " WHERE id = ?",
                (pending_id,),
            )

    def open_pending(
        self, kind: str | None = None, *, action: str | None = None, requester: str | None = None
    ) -> list[PendingAction]:
        sql = "SELECT id FROM pending_actions WHERE decision IS NULL AND expires_at > ?"
        params: tuple[Any, ...] = (_now(),)
        for column, value in (("kind", kind), ("action", action), ("requester", requester)):
            if value:
                sql += f" AND {column} = ?"
                params += (value,)
        with self._lock:
            ids = [r["id"] for r in self._conn.execute(sql + " ORDER BY id", params).fetchall()]
        return [p for p in (self.get_pending(i) for i in ids) if p]

    # -- webhook events ---------------------------------------------------

    def claim_event(self, source: str, key: str) -> bool:
        """Record a webhook event as handled; False when it already was.

        The insert is the claim, so two concurrent deliveries of one event
        cannot both act on it.
        """
        with self.transaction() as conn:
            return (
                conn.execute(
                    "INSERT OR IGNORE INTO webhook_events (source, event_key, received_at)"
                    " VALUES (?, ?, ?)",
                    (source, key, _now()),
                ).rowcount
                == 1
            )

    def release_event(self, source: str, key: str) -> None:
        """Forget a claim whose handling failed, so a later delivery can try again."""
        with self.transaction() as conn:
            conn.execute(
                "DELETE FROM webhook_events WHERE source = ? AND event_key = ?", (source, key)
            )
