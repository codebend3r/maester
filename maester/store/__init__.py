"""SQLite persistence: users, conversations, the audit log, reports, pending actions, webhooks, DMs.

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

from maester.notify import MediaRef

MIGRATIONS_DIR = Path(__file__).parent / "migrations"
RESULT_MAX_CHARS = 4000
# How long a DM about a title can still be reacted to.
SENT_MESSAGE_TTL = timedelta(days=30)


def _stamp(when: datetime) -> str:
    return when.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"


def _now() -> str:
    return _stamp(datetime.now(UTC))


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
    pending_id: int | None = None


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


class SeerrUserTaken(LookupError):
    """Another Discord account already holds a live link to this Seerr user."""


class NotLinked(LookupError):
    """A Discord account with no active link to a Seerr user: nothing can be done as them."""


@dataclass(frozen=True)
class LinkedUser:
    """An active link: who a Discord account is on Seerr (and Tautulli, when known)."""

    discord_id: str
    seerr_user_id: int
    tautulli_user_id: int | None
    name: str  # their Plex username, or email, as the admin knows them


# The one rule for "linked": the admin approved it, and it names a Seerr user.
_ACTIVE_LINK = "status = 'active' AND seerr_user_id IS NOT NULL"


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
        pending_id: int | None = None,
    ) -> int:
        """Record one tool call. Called by the tool runner, never by tools.

        `pending_id` marks a call that ended waiting on an admin approval.
        """
        result_json = json.dumps(result, default=str)
        if len(result_json) > RESULT_MAX_CHARS:
            # Keep the row readable: a cut-off JSON string would fail to parse
            # on the way back out, so store a marker plus a preview instead.
            result_json = json.dumps({"truncated": True, "preview": result_json[:RESULT_MAX_CHARS]})
        with self.transaction() as conn:
            cur = conn.execute(
                "INSERT INTO audit_log"
                " (ts, discord_id, tool, args, result, ok, host, duration_ms, pending_id)"
                " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (
                    _now(),
                    discord_id,
                    tool,
                    json.dumps(args, default=str),
                    result_json,
                    int(ok),
                    host,
                    duration_ms,
                    pending_id,
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
                pending_id=r["pending_id"],
            )
            for r in rows
        ]

    def audit_count_since(self, tool: str, since: datetime) -> int:
        """How many times `tool` acted since `since`; used by daily caps.

        A call that only asked for an approval did not act, so it is left out.
        """
        with self._lock:
            row = self._conn.execute(
                "SELECT COUNT(*) FROM audit_log"
                " WHERE tool = ? AND ok = 1 AND pending_id IS NULL AND ts >= ?",
                (tool, _stamp(since)),
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
        try:
            with self.transaction() as conn:
                conn.execute("INSERT OR IGNORE INTO users (discord_id) VALUES (?)", (discord_id,))
                if fields:
                    assignments = ", ".join(f"{k} = ?" for k in fields)
                    conn.execute(
                        f"UPDATE users SET {assignments} WHERE discord_id = ?",
                        (*fields.values(), discord_id),
                    )
        except sqlite3.IntegrityError as exc:
            if "seerr_user_id" in str(exc):
                raise SeerrUserTaken(f"Seerr user {fields.get('seerr_user_id')} is taken") from exc
            raise
        return self.get_user(discord_id)  # type: ignore[return-value]

    def get_user(self, discord_id: str) -> UserRow | None:
        with self._lock:
            r = self._conn.execute(
                "SELECT * FROM users WHERE discord_id = ?", (discord_id,)
            ).fetchone()
        return self._user(r)

    def active_link(self, discord_id: str) -> LinkedUser | None:
        with self._lock:
            r = self._conn.execute(
                f"SELECT * FROM users WHERE discord_id = ? AND {_ACTIVE_LINK}", (discord_id,)
            ).fetchone()
        return self._link(r)

    def active_link_by_seerr_id(self, seerr_user_id: int) -> LinkedUser | None:
        """Whose request a Seerr user's is: the Discord account actively linked to it."""
        with self._lock:
            r = self._conn.execute(
                f"SELECT * FROM users WHERE seerr_user_id = ? AND {_ACTIVE_LINK}", (seerr_user_id,)
            ).fetchone()
        return self._link(r)

    @staticmethod
    def _link(r: sqlite3.Row | None) -> LinkedUser | None:
        if r is None:
            return None
        name = r["plex_username"] or r["plex_email"] or r["discord_id"]
        return LinkedUser(r["discord_id"], r["seerr_user_id"], r["tautulli_user_id"], name)

    def user_by_seerr_id(self, seerr_user_id: int) -> UserRow | None:
        """Any live (pending or active) link to a Seerr user; linking allows one at a time."""
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
            params += (_stamp(since),)
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
        expires = _stamp(datetime.now(UTC) + ttl)
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

    def claim_event(self, source: str, key: str, *, window: timedelta) -> bool:
        """Record a webhook event as handled; False when it already was within `window`.

        Claims older than the window are dropped first, which keeps the table
        small and lets a later occurrence of the same event through. The
        insert is the claim, so two concurrent deliveries cannot both act.
        """
        cutoff = _stamp(datetime.now(UTC) - window)
        with self.transaction() as conn:
            conn.execute("DELETE FROM webhook_events WHERE received_at < ?", (cutoff,))
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

    # -- sent messages ----------------------------------------------------

    def remember_message(self, message_id: str, to: str, about: MediaRef) -> None:
        """Record what a DM was about, and forget ones too old to react to."""
        cutoff = _stamp(datetime.now(UTC) - SENT_MESSAGE_TTL)
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
                    _now(),
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

    # -- reports ----------------------------------------------------------

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
                    _now(),
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
                (_now(), host, media_type, file_id),
            )

    def set_issue_resolved(self, seerr_issue_id: int, resolved: bool) -> list[ReportRow]:
        """Follow a Seerr issue being resolved or reopened; returns the reports that changed."""
        with self.transaction() as conn:
            changed = conn.execute(
                "UPDATE reports SET resolved_at = ?"
                " WHERE seerr_issue_id = ? AND (resolved_at IS NULL) = ? RETURNING id",
                (_now() if resolved else None, seerr_issue_id, int(resolved)),
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
