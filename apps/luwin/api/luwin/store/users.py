"""Who someone signed in through rookery is on Plex, Seerr and Tautulli, and their tier override.

`user_id` is rookery's user id. A user is linked once their Plex account
matches a Seerr user: that match is what lets luwin act as them.
"""

from __future__ import annotations

import sqlite3
from dataclasses import dataclass
from typing import Any

from luwin.store.base import Database


@dataclass(frozen=True)
class UserRow:
    user_id: str
    plex_id: str | None
    plex_email: str | None
    plex_username: str | None
    thumb: str | None
    seerr_user_id: int | None
    tautulli_user_id: int | None
    seerr_checked_at: str | None
    tier_override: str | None
    last_seen_at: str | None


class NotLinked(LookupError):
    """A user whose Plex account matches no Seerr user: nothing can be done as them."""


@dataclass(frozen=True)
class LinkedUser:
    """A linked user: who they are on Seerr (and Tautulli, when known)."""

    user_id: str
    seerr_user_id: int
    tautulli_user_id: int | None
    name: str  # their Plex username, or email, as the admin knows them


# The one rule for "linked": the Plex account matched a Seerr user.
_LINKED = "seerr_user_id IS NOT NULL"

_FIELDS = {
    "plex_id",
    "plex_email",
    "plex_username",
    "thumb",
    "seerr_user_id",
    "tautulli_user_id",
    "seerr_checked_at",
    "tier_override",
    "last_seen_at",
}


class Users(Database):
    def upsert_user(self, user_id: str, **fields: Any) -> UserRow:
        unknown = set(fields) - _FIELDS
        if unknown:
            raise ValueError(f"unknown user fields: {sorted(unknown)}")
        with self.transaction() as conn:
            conn.execute("INSERT OR IGNORE INTO users (user_id) VALUES (?)", (user_id,))
            if fields:
                assignments = ", ".join(f"{k} = ?" for k in fields)
                conn.execute(
                    f"UPDATE users SET {assignments} WHERE user_id = ?",
                    (*fields.values(), user_id),
                )
        return self.get_user(user_id)  # type: ignore[return-value]

    def get_user(self, user_id: str) -> UserRow | None:
        with self._lock:
            r = self._conn.execute("SELECT * FROM users WHERE user_id = ?", (user_id,)).fetchone()
        return self._user(r)

    def active_link(self, user_id: str) -> LinkedUser | None:
        with self._lock:
            r = self._conn.execute(
                f"SELECT * FROM users WHERE user_id = ? AND {_LINKED}", (user_id,)
            ).fetchone()
        return self._link(r)

    def active_link_by_seerr_id(self, seerr_user_id: int) -> LinkedUser | None:
        """Whose request a Seerr user's is: the user linked to it, the most recently seen first."""
        with self._lock:
            r = self._conn.execute(
                f"SELECT * FROM users WHERE seerr_user_id = ? AND {_LINKED}"
                " ORDER BY last_seen_at DESC LIMIT 1",
                (seerr_user_id,),
            ).fetchone()
        return self._link(r)

    @staticmethod
    def _link(r: sqlite3.Row | None) -> LinkedUser | None:
        if r is None:
            return None
        name = r["plex_username"] or r["plex_email"] or r["user_id"]
        return LinkedUser(r["user_id"], r["seerr_user_id"], r["tautulli_user_id"], name)

    def active_users(self) -> list[UserRow]:
        """Every linked user."""
        with self._lock:
            rows = self._conn.execute(f"SELECT * FROM users WHERE {_LINKED}").fetchall()
        return [u for u in map(self._user, rows) if u is not None]

    @staticmethod
    def _user(r: sqlite3.Row | None) -> UserRow | None:
        if r is None:
            return None
        return UserRow(
            user_id=r["user_id"],
            plex_id=r["plex_id"],
            plex_email=r["plex_email"],
            plex_username=r["plex_username"],
            thumb=r["thumb"],
            seerr_user_id=r["seerr_user_id"],
            tautulli_user_id=r["tautulli_user_id"],
            seerr_checked_at=r["seerr_checked_at"],
            tier_override=r["tier_override"],
            last_seen_at=r["last_seen_at"],
        )
