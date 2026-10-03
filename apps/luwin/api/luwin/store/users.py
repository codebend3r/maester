"""Who a Discord account is on Plex, Seerr and Tautulli, and its tier override."""

from __future__ import annotations

import sqlite3
from dataclasses import dataclass
from enum import StrEnum
from typing import Any

from luwin.store.base import Database


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


class Users(Database):
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

    def active_users(self) -> list[UserRow]:
        """Every Discord account with an active link."""
        with self._lock:
            rows = self._conn.execute(f"SELECT * FROM users WHERE {_ACTIVE_LINK}").fetchall()
        return [u for u in map(self._user, rows) if u is not None]

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
