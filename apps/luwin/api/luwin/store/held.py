"""Calls held for a maintenance window, run once it ends.

A call is marked run before it runs (`start_held`), so two ends can't run
it twice; one that failed in a way worth trying again is held once more
(`keep_held`) for the next end.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any

from luwin.store.base import Database, now


@dataclass(frozen=True)
class HeldCall:
    id: int
    ts: str
    discord_id: str
    tool: str
    args: dict[str, Any]
    summary: str


class HeldCalls(Database):
    def hold_call(
        self, *, discord_id: str, tool: str, args: dict[str, Any], summary: str
    ) -> HeldCall:
        ts = now()
        with self.transaction() as conn:
            cur = conn.execute(
                "INSERT INTO held_calls (ts, discord_id, tool, args, summary)"
                " VALUES (?, ?, ?, ?, ?)",
                (ts, discord_id, tool, json.dumps(args, default=str), summary),
            )
            return HeldCall(int(cur.lastrowid), ts, discord_id, tool, args, summary)

    def held_calls(self) -> list[HeldCall]:
        """Every call still waiting for maintenance to end, oldest first."""
        with self._lock:
            rows = self._conn.execute(
                "SELECT * FROM held_calls WHERE ran_at IS NULL ORDER BY id"
            ).fetchall()
        return [
            HeldCall(
                r["id"],
                r["ts"],
                r["discord_id"],
                r["tool"],
                json.loads(r["args"]),
                r["summary"],
            )
            for r in rows
        ]

    def start_held(self, held_id: int) -> bool:
        """Mark a held call as run; False when something else already ran it."""
        with self.transaction() as conn:
            return (
                conn.execute(
                    "UPDATE held_calls SET ran_at = ? WHERE id = ? AND ran_at IS NULL",
                    (now(), held_id),
                ).rowcount
                == 1
            )

    def keep_held(self, held_id: int) -> None:
        """Hold a call again: its run failed in a way worth trying again (a service still down)."""
        with self.transaction() as conn:
            conn.execute("UPDATE held_calls SET ran_at = NULL WHERE id = ?", (held_id,))
