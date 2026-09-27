"""The server's upload, measured on demand, against the remote streams it carries.

A friend away from home streams over the servers' upload: the hosts share
one network behind one internet connection, so one test measures it for
all of them. The test runs in maester's own container (`SPEEDTEST_HOST`,
`clients/speedtest.py`), alongside the streams already going out, so the
upload it finds is what those streams leave free: the headroom. It's read
next to what every host's remote streams send (their bitrates, from
Tautulli, read while the test runs) and put in plain words.

A test briefly fills the upload for everyone's streams, so tests are
rationed. A result answers for `REUSE`, and a new test runs at most every
`MIN_GAP`, failed or not; in between, the last result is given with its age
and when the next test can run. One test runs at a time, and everyone who
asks while it runs gets its result (`Memo`). Other tools (the lag advice,
version picking) use a result while it's within `REUSE`, and never start one.
"""

from __future__ import annotations

import asyncio
from dataclasses import dataclass
from datetime import timedelta
from typing import Any

from maester.clients import Services
from maester.clients.speedtest import SpeedResult, SpeedTester, SpeedTestFailed
from maester.formatting import ago, humanized, megabits
from maester.memo import Memo
from maester.perf.load import mbps, read_loads

# A result answers for this long; after it, it no longer describes the connection.
REUSE = timedelta(minutes=10)
# A new test runs at most this often, failed or not: three an hour.
MIN_GAP = timedelta(minutes=20)
# About what one remote 1080p stream takes. Less free upload than this is tight;
# three times it is plenty.
HD_STREAM_KBPS = 8000
ROOMY_KBPS = 3 * HD_STREAM_KBPS


@dataclass(frozen=True)
class Uplink:
    """A speed test's result, and the remote streams going out while it ran."""

    host: str  # where it ran
    result: SpeedResult
    streaming_kbps: int  # every host's remote streams, together
    uncounted: tuple[str, ...]  # hosts whose streams couldn't be read

    @property
    def spare_kbps(self) -> int:
        """The test shares the upload with the streams, so what it got is what they leave."""
        return round(self.result.upload_mbps * 1000)

    @property
    def tight(self) -> bool:
        """Too little upload left for another HD stream."""
        return self.spare_kbps < HD_STREAM_KBPS

    def headroom(self) -> str:
        spare = megabits(self.spare_kbps)
        alongside = (
            f"alongside {megabits(self.streaming_kbps)} Mbps of remote streams"
            if self.streaming_kbps
            else "with no remote streams running"
        )
        if self.spare_kbps >= ROOMY_KBPS:
            return f"Plenty of room: about {spare} Mbps of upload is free {alongside}."
        if not self.tight:
            return (
                f"Some room: about {spare} Mbps of upload is free {alongside}, enough for "
                "another HD stream."
            )
        return (
            f"The upload is nearly full: only about {spare} Mbps is free {alongside}, so "
            "remote streams will stutter until some finish or play at a lower quality."
        )

    def as_dict(self) -> dict[str, Any]:
        result = self.result
        facts: dict[str, Any] = {
            "upload_mbps": result.upload_mbps,
            "download_mbps": result.download_mbps,
            "ping_ms": result.ping_ms,
            "test_server": result.server,
            "isp": result.isp,
            "result_link": result.url,
            "remote_streams_mbps": mbps(self.streaming_kbps),
            "headroom": self.headroom(),
        }
        if self.uncounted:
            facts["streams_not_counted"] = f"couldn't read {', '.join(self.uncounted)}"
        return facts


@dataclass(frozen=True)
class NotMeasured:
    host: str
    why: str


Measurement = Uplink | NotMeasured


def memo_key(host: str) -> str:
    return f"speed_test:{host}"


async def _run(tester: SpeedTester) -> SpeedResult | NotMeasured:
    try:
        return await tester.measure()
    except SpeedTestFailed as exc:
        return NotMeasured(tester.host, str(exc))


async def measure(services: Services, tester: SpeedTester) -> Measurement:
    """Run a test, reading every host's remote streams while it runs."""
    result, loads = await asyncio.gather(_run(tester), read_loads(services))
    if isinstance(result, NotMeasured):
        return result
    return Uplink(tester.host, result, loads.remote_kbps, tuple(sorted(loads.unreachable)))


@dataclass(frozen=True)
class Reading:
    """A measurement as a speed test answers with it: how old it is, and when the next
    test may run (zero when one could run now)."""

    found: Measurement
    age: timedelta
    next_test_in: timedelta

    @property
    def rationed(self) -> bool:
        """Older than `REUSE`, and still too soon for another test."""
        return self.age >= REUSE and self.next_test_in > timedelta(0)

    def wait(self) -> str:
        minutes = humanized(int(self.next_test_in.total_seconds()))
        return (
            f"Tests run at most every {MIN_GAP // timedelta(minutes=1)} minutes, since each one "
            f"briefly fills the upload; the next can run in {minutes}."
        )

    def as_dict(self) -> dict[str, Any]:
        facts: dict[str, Any] = {"host": self.found.host, "measured": ago(self.age)}
        if isinstance(self.found, Uplink):
            facts.update(self.found.as_dict())
        if self.rationed:
            facts["next_test"] = self.wait()
        return facts


async def reading(memo: Memo, services: Services, tester: SpeedTester) -> Reading:
    """The last result while it's fresh or too soon to replace; else a new test's."""
    key = memo_key(tester.host)
    kept = memo.latest(key)
    if kept is None or not REUSE <= memo.age(kept) < MIN_GAP:
        kept = await memo.fresh(key, REUSE, lambda: measure(services, tester))
    age = memo.age(kept)
    return Reading(kept.value, age, max(MIN_GAP - age, timedelta(0)))


def recent(memo: Memo, tester: SpeedTester | None) -> Uplink | None:
    """The last test's result while it still describes the connection; never starts one."""
    kept = memo.latest(memo_key(tester.host)) if tester is not None else None
    if kept is None or memo.age(kept) >= REUSE or not isinstance(kept.value, Uplink):
        return None
    return kept.value
