"""Calls held for a maintenance window, run once it ends."""

from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any

from maester.store.base import Database, now


@dataclass(frozen=True)
class HeldCall:
    id: int
    ts: str
    discord_id: str
    tier: str
    tool: str
    args: dict[str, Any]
    summary: str


class HeldCalls(Database):
    def hold_call(
        self, *, discord_id: str, tier: str, tool: str, args: dict[str, Any], summary: str
    ) -> HeldCall:
        ts = now()
        with self.transaction() as conn:
            cur = conn.execute(
                "INSERT INTO held_calls (ts, discord_id, tier, tool, args, summary)"
                " VALUES (?, ?, ?, ?, ?, ?)",
                (ts, discord_id, tier, tool, json.dumps(args, default=str), summary),
            )
            return HeldCall(int(cur.lastrowid), ts, discord_id, tier, tool, args, summary)

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
                r["tier"],
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
