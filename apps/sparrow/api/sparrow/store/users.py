"""Who a raven account is here: its email, its standing with raven, its Seerr match, and
its tier override.

`user_id` is the raven account's id. A user is linked once their email matches a
Seerr user: that match is what lets sparrow act as them in Seerr.
"""

from __future__ import annotations

import sqlite3
from dataclasses import dataclass
from typing import Any

from sparrow.store.base import Database


@dataclass(frozen=True)
class UserRow:
    user_id: str
    email: str | None
    raven_status: str | None  # pending | approved | revoked, as raven last said
    is_owner: bool
    seerr_user_id: int | None
    seerr_checked_at: str | None
    tier_override: str | None
    last_seen_at: str | None


class NotLinked(LookupError):
    """A user whose email matches no Seerr user: nothing can be done as them in Seerr."""


@dataclass(frozen=True)
class LinkedUser:
    """A linked user: who they are on Seerr."""

    user_id: str
    seerr_user_id: int
    name: str  # their email, as the admin knows them


# The one rule for "linked": the email matched a Seerr user.
_LINKED = "seerr_user_id IS NOT NULL"

_FIELDS = {
    "email",
    "raven_status",
    "is_owner",
    "seerr_user_id",
    "seerr_checked_at",
    "tier_override",
    "last_seen_at",
}


class Users(Database):
    def upsert_user(self, user_id: str, **fields: Any) -> UserRow:
        unknown = set(fields) - _FIELDS
        if unknown:
            raise ValueError(f"unknown user fields: {sorted(unknown)}")
        assignments = "".join(f", {k} = ?" for k in fields)
        with self.transaction() as conn:
            conn.execute("INSERT OR IGNORE INTO users (user_id) VALUES (?)", (user_id,))
            row = conn.execute(
                f"UPDATE users SET user_id = user_id{assignments} WHERE user_id = ? RETURNING *",
                (*fields.values(), user_id),
            ).fetchone()
        user = self._user(row)
        if user is None:
            raise LookupError(f"user {user_id} vanished while being saved")
        return user

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
        return LinkedUser(r["user_id"], r["seerr_user_id"], r["email"] or r["user_id"])

    @staticmethod
    def _user(r: sqlite3.Row | None) -> UserRow | None:
        if r is None:
            return None
        return UserRow(
            user_id=r["user_id"],
            email=r["email"],
            raven_status=r["raven_status"],
            is_owner=bool(r["is_owner"]),
            seerr_user_id=r["seerr_user_id"],
            seerr_checked_at=r["seerr_checked_at"],
            tier_override=r["tier_override"],
            last_seen_at=r["last_seen_at"],
        )
