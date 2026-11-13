"""Each user's conversation, trimmed to a token budget when read back."""

from __future__ import annotations

import enum
import json
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import datetime
from typing import Any

from sparrow.store.base import Database, now, stamp


class Role(enum.StrEnum):
    USER = "user"
    ASSISTANT = "assistant"


@dataclass(frozen=True)
class StoredMessage:
    """One Messages API message as it is kept: who said it, its content, its rough tokens."""

    role: Role
    content: Any
    tokens: int = 0


class Conversations(Database):
    def append_messages(self, user_id: str, messages: Sequence[StoredMessage]) -> None:
        """Keep `messages` together or not at all: a tool call and its result are one step."""
        with self.transaction() as conn:
            conn.executemany(
                "INSERT INTO conversations (user_id, role, content, tokens, created_at)"
                " VALUES (?, ?, ?, ?, ?)",
                [
                    (user_id, m.role, json.dumps(m.content, default=str), m.tokens, now())
                    for m in messages
                ],
            )

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
        while kept and not (kept[0]["role"] == Role.USER and isinstance(kept[0]["content"], str)):
            kept.pop(0)
        return kept

    def clear_messages(self, user_id: str) -> int:
        with self.transaction() as conn:
            return conn.execute("DELETE FROM conversations WHERE user_id = ?", (user_id,)).rowcount
