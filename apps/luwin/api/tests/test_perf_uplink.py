from datetime import UTC, datetime, timedelta

import pytest

from luwin.clients.speedtest import FakeSpeedTest, SpeedResult
from luwin.memo import Memo
from luwin.perf.uplink import (
    MIN_GAP,
    REUSE,
    SPEED_TEST,
    NotMeasured,
    Uplink,
    can_test,
    reading,
    recent,
)
from tests.factories import session


def result(upload_mbps: float) -> SpeedResult:
    return SpeedResult(round(upload_mbps * 1000), 900_000, 8.0, "Rogers, Toronto", "Rogers", "u")


class Clock:
    def __init__(self):
        self.now = datetime(2026, 9, 27, 10, 0, tzinfo=UTC)

    def __call__(self):
        return self.now


@pytest.mark.parametrize(
    ("upload", "streaming", "said"),
    [
        (40.0, 12000, "Plenty of room: about 40 Mbps of upload is free alongside 12 Mbps of remote streams."),
        (10.0, 0, "Some room: about 10 Mbps of upload is free with no remote streams running, enough for another HD stream."),
        (3.2, 18500, "The upload is nearly full: only about 3.2 Mbps is free alongside 18.5 Mbps of remote streams"),
    ],
)  # fmt: skip
def test_headroom_in_plain_words(upload, streaming, said):
    measured = Uplink("meleys", result(upload), streaming, ())
    assert measured.headroom().startswith(said)
    assert measured.tight is (upload < 8)


async def test_a_test_reads_every_hosts_remote_streams_as_it_runs(services):
    services.tautulli["meleys"].sessions = [session(location="wan", stream_bitrate_kbps=8000)]
    services.tautulli["vermithor"].sessions = [
        session(location="wan", stream_bitrate_kbps=6000),
        session(location="lan", stream_bitrate_kbps=60000),
    ]
    services.speedtest = tester = FakeSpeedTest(result=result(22.0))
    found = await reading(Memo(), services, tester)
    assert found.found == Uplink("meleys", result(22.0), 14000, ())
    facts = found.as_dict()
    assert (facts["measured"], facts["remote_streams_mbps"], "next_test" in facts) == (
        "just now", 14.0, False,
    )  # fmt: skip


async def test_tests_are_reused_then_rationed_then_run_again(services):
    clock = Clock()
    memo, tester = Memo(clock), FakeSpeedTest(result=result(30.0))
    await reading(memo, services, tester)
    clock.now += REUSE - timedelta(seconds=1)
    assert (await reading(memo, services, tester)).found.result.upload_kbps == 30_000
    assert recent(memo) is not None and not can_test(memo, tester)
    tester.result = result(5.0)
    clock.now += timedelta(minutes=5)  # past REUSE, before MIN_GAP: the last one, flagged
    rationed = await reading(memo, services, tester)
    assert rationed.rationed and rationed.found.result.upload_kbps == 30_000
    assert "the next can run in about 5 min" in rationed.as_dict()["next_test"]
    assert recent(memo) is None  # too old to describe the connection now
    clock.now = memo.latest(SPEED_TEST).at + MIN_GAP
    assert can_test(memo, tester)
    assert (await reading(memo, services, tester)).found.result.upload_kbps == 5_000
    assert tester.runs == 2


async def test_a_failed_test_is_rationed_too(services):
    clock = Clock()
    memo, tester = Memo(clock), FakeSpeedTest()
    failed = await reading(memo, services, tester)
    assert failed.found == NotMeasured("meleys", tester.why)
    clock.now += timedelta(minutes=12)
    assert (await reading(memo, services, tester)).found == failed.found
    assert tester.runs == 1 and recent(memo) is None
    assert not can_test(memo, tester)  # a speed test now would only be refused
    assert not can_test(Memo(), None)  # nor is there one without a tester
