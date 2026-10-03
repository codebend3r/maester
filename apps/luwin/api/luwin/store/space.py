"""Free space per volume, sampled once a day, for the disk forecast."""

from __future__ import annotations

from collections.abc import Iterable
from dataclasses import dataclass
from datetime import date, timedelta

from maester.store.base import Database

# Kept a while past the forecast's 30 days, so a longer look back stays possible.
SAMPLES_KEPT = timedelta(days=90)


@dataclass(frozen=True)
class SpaceSample:
    volume: str  # '<path>|<total bytes>|<hosts>'
    day: date
    label: str
    free_bytes: int
    total_bytes: int


class SpaceSamples(Database):
    def record_space(self, day: date, samples: Iterable[SpaceSample]) -> None:
        """Today's samples, replacing any taken earlier today; old ones are pruned."""
        with self.transaction() as conn:
            conn.execute(
                "DELETE FROM space_samples WHERE day < ?", ((day - SAMPLES_KEPT).isoformat(),)
            )
            conn.executemany(
                "INSERT OR REPLACE INTO space_samples"
                " (volume, day, label, free_bytes, total_bytes) VALUES (?, ?, ?, ?, ?)",
                [
                    (s.volume, s.day.isoformat(), s.label, s.free_bytes, s.total_bytes)
                    for s in samples
                ],
            )

    def space_since(self, since: date) -> list[SpaceSample]:
        """Every sample from `since` on, oldest first."""
        with self._lock:
            rows = self._conn.execute(
                "SELECT * FROM space_samples WHERE day >= ? ORDER BY day, volume",
                (since.isoformat(),),
            ).fetchall()
        return [
            SpaceSample(
                r["volume"],
                date.fromisoformat(r["day"]),
                r["label"],
                r["free_bytes"],
                r["total_bytes"],
            )
            for r in rows
        ]
