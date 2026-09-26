"""Per-user limits and the global kill switch.

Limits are in memory: they exist to stop a runaway conversation or a
crafted message from burning tokens, and losing the counters on restart is
an acceptable reset. The audit log is the durable record.
"""

from __future__ import annotations

import time
from collections import defaultdict, deque
from dataclasses import dataclass, field


class LimitExceeded(Exception):
    def __init__(self, what: str, retry_hint: str):
        self.what, self.retry_hint = what, retry_hint
        super().__init__(f"{what} limit reached; {retry_hint}")


@dataclass
class RateLimiter:
    messages_per_hour: int
    tokens_per_day: int
    clock: callable = time.time  # type: ignore[assignment]
    _messages: dict[str, deque[float]] = field(default_factory=lambda: defaultdict(deque))
    _tokens: dict[str, tuple[int, float]] = field(default_factory=dict)  # (count, day_start)

    def check_message(self, user_id: str) -> None:
        now = self.clock()
        window = self._messages[user_id]
        while window and window[0] < now - 3600:
            window.popleft()
        if len(window) >= self.messages_per_hour:
            raise LimitExceeded("message", "try again in a bit")
        window.append(now)

    def check_tokens(self, user_id: str) -> None:
        count, _ = self._today(user_id)
        if count >= self.tokens_per_day:
            raise LimitExceeded("daily usage", "try again tomorrow")

    def add_tokens(self, user_id: str, tokens: int) -> int:
        count, day = self._today(user_id)
        self._tokens[user_id] = (count + tokens, day)
        return count + tokens

    def _today(self, user_id: str) -> tuple[int, float]:
        now = self.clock()
        day_start = now - (now % 86400)
        count, day = self._tokens.get(user_id, (0, day_start))
        if day != day_start:
            count, day = 0, day_start
        self._tokens[user_id] = (count, day)
        return count, day


@dataclass
class KillSwitch:
    """When on, every destructive tool refuses immediately.

    Flipped by an admin command; checked by the runner on every destructive
    call so there is no window where a queued confirmation can still fire.
    """

    enabled: bool = False
    reason: str = ""

    def on(self, reason: str = "") -> None:
        self.enabled, self.reason = True, reason

    def off(self) -> None:
        self.enabled, self.reason = False, ""
