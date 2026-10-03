"""Each user's conversation, trimmed to a token budget when read back."""

from __future__ import annotations

import json
from datetime import datetime
from typing import Any

from luwin.store.base import Database, now, stamp


class Conversations(Database):
    def append_message(self, user_id: str, role: str, content: Any, tokens: int = 0) -> int:
        with self.transaction() as conn:
            cur = conn.execute(
                "INSERT INTO conversations (user_id, role, content, tokens, created_at) VALUES (?, ?, ?, ?, ?)",
                (user_id, role, json.dumps(content, default=str), tokens, now()),
            )
            return int(cur.lastrowid)

    def recent_messages(
        self, user_id: str, *, max_tokens: int, since: datetime | None = None
    ) -> list[dict[str, Any]]:
        """The newest messages whose token sum fits the budget, oldest first.

        Messages older than `since` are left out, which is how an idle
        conversation starts fresh. The window is then trimmed to begin on a
        plain user message: a `tool_result` without the `tool_use` it answers
        is rejected by the API, so a cut inside a tool exchange is never sent.
        """
        sql = "SELECT role, content, tokens FROM conversations WHERE user_id = ?"
        params: tuple[Any, ...] = (user_id,)
        if since is not None:
            sql += " AND created_at >= ?"
            params += (stamp(since),)
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

    def clear_messages(self, user_id: str) -> int:
        with self.transaction() as conn:
            return conn.execute("DELETE FROM conversations WHERE user_id = ?", (user_id,)).rowcount
