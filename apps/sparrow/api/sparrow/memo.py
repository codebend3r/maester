"""Answers tools share across calls for a while, fetched once however many ask at once.

A health check or a speed test costs the services (or the upload) something,
and friends ask in bursts ("is Plex down?" from three people at midnight), so
a tool keeps its answer under a key and reuses it while it's fresh. While
one call fetches a key, the others asking for it wait and share that answer
instead of fetching again. How long an answer stays fresh is each tool's
call. A key (`Key[T]`) names the question and the type of its answer, so what
comes back is typed. Kept in memory: a restart starts fresh, which only
costs one lookup.
"""

from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any


@dataclass(frozen=True)
class Key[T]:
    """A question tools share the answer to; `T` is the answer's type."""

    name: str


@dataclass(frozen=True)
class Kept[T]:
    value: T
    at: datetime  # when it was fetched


class Memo:
    def __init__(self, clock: Callable[[], datetime] = lambda: datetime.now(UTC)):
        self._clock = clock
        self._kept: dict[Key[Any], Kept[Any]] = {}
        self._fetching: dict[Key[Any], asyncio.Lock] = {}

    def age(self, kept: Kept[Any]) -> timedelta:
        return self._clock() - kept.at

    def latest[T](self, key: Key[T]) -> Kept[T] | None:
        """The last answer kept under `key`, however old."""
        return self._kept.get(key)

    async def fresh[T](
        self, key: Key[T], within: timedelta, fetch: Callable[[], Awaitable[T]]
    ) -> Kept[T]:
        """The answer kept under `key` while it's younger than `within`; else `fetch`'s.

        A fetch that raises keeps nothing, so the next call tries again.
        """
        async with self._fetching.setdefault(key, asyncio.Lock()):
            kept = self._kept.get(key)
            if kept is None or self.age(kept) >= within:
                kept = self._kept[key] = Kept(await fetch(), self._clock())
            return kept
