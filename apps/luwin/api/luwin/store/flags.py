"""Flags: switches the admin flips from chat that must outlive a restart.

The kill switch and a maintenance window are each one flag. A flag is up
while its row exists; raising it again replaces its message but keeps when
it went up.
"""

from __future__ import annotations

from dataclasses import dataclass

from luwin.store.base import Database, now

KILL = "kill"
MAINTENANCE = "maintenance"


@dataclass(frozen=True)
class Flag:
    name: str
    message: str  # the reason or announcement, as the admin gave it
    set_by: str | None
    set_at: str


class Flags(Database):
    def flag(self, name: str) -> Flag | None:
        """The flag while it's up; None when it's down."""
        with self._lock:
            r = self._conn.execute("SELECT * FROM flags WHERE name = ?", (name,)).fetchone()
        return Flag(r["name"], r["message"], r["set_by"], r["set_at"]) if r else None

    def raise_flag(self, name: str, message: str = "", set_by: str | None = None) -> Flag:
        """Raise the flag; raised already, it keeps when it went up and takes the new message."""
        with self.transaction() as conn:
            conn.execute(
                "INSERT INTO flags (name, message, set_by, set_at) VALUES (?, ?, ?, ?)"
                " ON CONFLICT (name) DO UPDATE SET message = excluded.message,"
                " set_by = excluded.set_by",
                (name, message, set_by, now()),
            )
        return self.flag(name)  # type: ignore[return-value]

    def lower_flag(self, name: str) -> Flag | None:
        """Take the flag down; returns it as it was, or None when it wasn't up."""
        with self.transaction() as conn:
            r = conn.execute("DELETE FROM flags WHERE name = ? RETURNING *", (name,)).fetchone()
        return Flag(r["name"], r["message"], r["set_by"], r["set_at"]) if r else None
