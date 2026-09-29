"""When a job runs: at a time of day (every day, or one day a week), or every so often.

A job at a time of day runs by the wall clock in the server's time zone, so
8:00 stays 8:00 across a clock change. Each run is a slot, its due time,
which the scheduler claims before running, so a restart never runs one twice.
Slots come back in UTC: Python subtracts two times in one zone by the wall
clock, which is an hour off across a clock change.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, date, datetime, time, timedelta
from zoneinfo import ZoneInfo

# Far enough to find the next slot of a weekly job from any day.
_WEEK = 8


@dataclass(frozen=True)
class Every:
    """Every `interval`, counted from when the app started."""

    interval: timedelta


@dataclass(frozen=True)
class At:
    """At `at` each day in `zone`, or only on `weekday` (0 for Monday) when given."""

    at: time
    zone: ZoneInfo
    weekday: int | None = None

    def _slot(self, day: date) -> datetime | None:
        if self.weekday is not None and day.weekday() != self.weekday:
            return None
        return datetime.combine(day, self.at, tzinfo=self.zone).astimezone(UTC)

    def _slots(self, around: datetime, step: int) -> list[datetime]:
        today = around.astimezone(self.zone).date()
        days = (today + timedelta(days=step * n) for n in range(-1, _WEEK))
        return [s for s in map(self._slot, days) if s is not None]

    def last(self, now: datetime) -> datetime:
        """The latest slot at or before `now`."""
        return max(s for s in self._slots(now, -1) if s <= now)

    def next(self, now: datetime) -> datetime:
        """The first slot after `now`."""
        return min(s for s in self._slots(now, 1) if s > now)
