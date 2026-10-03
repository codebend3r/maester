import pytest

from luwin.clients import ClientError
from luwin.clients.fleet import Vitals
from luwin.perf.load import read_loads
from tests.factories import session


def transcode(speed: float, *, throttled: bool = False, **kw):
    return session(transcode_decision="transcode", video_decision="transcode", transcode_speed=speed, transcode_throttled=throttled, **kw)  # fmt: skip


async def test_a_conversion_slower_than_playback_makes_a_host_busy(services):
    services.tautulli["vermithor"].sessions = [transcode(0.7), transcode(2.4)]
    # Throttled means the transcoder got ahead and is resting, so its low speed is fine.
    services.tautulli["meleys"].sessions = [transcode(0.4, throttled=True)]
    loads = await read_loads(services)
    busy, calm = loads.hosts["vermithor"], loads.hosts["meleys"]
    assert busy.behind == 1 and busy.strain == ("1 stream converting slower than playback",)
    assert not calm.busy and loads.busy == (busy,)
    assert loads.verdict() == (
        "Yes, the server is busy (vermithor: 1 stream converting slower than playback)."
    )
    assert loads.as_dict()["load_is_a_plausible_cause"] is True


async def test_cpu_and_memory_from_the_fleet_monitor_count_where_known(services):
    services.fleet.readings = {
        "meleys": Vitals(97.0, 40.0),
        "vermithor": Vitals(30.0, 93.5),
        "caraxes": Vitals(99.0, 99.0),  # no Plex host luwin knows
    }
    loads = await read_loads(services)
    assert loads.hosts["meleys"].strain == ("its CPU is at 97%",)
    assert loads.hosts["vermithor"].strain == ("its memory is 94% used",)
    assert set(loads.hosts) == {"meleys", "vermithor"}
    facts = loads.as_dict()["hosts"]["meleys"]
    assert (facts["cpu_percent"], facts["memory_percent"], facts["busy"]) == (97.0, 40.0, True)


async def test_a_calm_server_is_unlikely_to_be_the_cause_and_only_what_was_read_is_fine(services):
    services.fleet.readings = {"meleys": Vitals(12.0, 50.0), "vermithor": Vitals(20.0, 40.0)}
    loads = await read_loads(services)
    assert loads.verdict() == (
        "Unlikely: every conversion on meleys, vermithor keeps up, and their CPU and memory "
        "are fine."
    )
    assert loads.as_dict()["load_is_a_plausible_cause"] is False
    assert "cpu_and_memory" not in loads.as_dict()
    # The monitor answered but has nothing recent on vermithor: that isn't "fine".
    services.fleet.readings = {"meleys": Vitals(12.0, 50.0)}
    assert (await read_loads(services)).verdict() == (
        "Unlikely: every conversion on meleys, vermithor keeps up (no recent CPU or memory "
        "reading for vermithor)."
    )


async def test_without_the_fleet_monitor_cpu_and_memory_are_unknown(services):
    services.fleet = None
    loads = await read_loads(services)
    assert loads.vitals_note == "unknown: no fleet monitor is set up"
    assert loads.verdict() == (
        "Unlikely: every conversion on meleys, vermithor keeps up (CPU and memory unknown: no "
        "fleet monitor is set up)."
    )
    assert "cpu_percent" not in loads.as_dict()["hosts"]["meleys"]


class Down:
    async def activity(self):
        raise ClientError("tautulli", "GET", "/api/v2", None, "connection refused")


async def test_a_host_that_cant_answer_is_named_and_the_monitor_failing_is_noted(services):
    services.tautulli["meleys"] = Down()
    services.fleet.down = True
    loads = await read_loads(services)
    assert set(loads.hosts) == {"vermithor"} and "connection refused" in loads.unreachable["meleys"]
    assert loads.vitals_note.startswith("unknown: the fleet monitor didn't answer")
    verdict = loads.verdict()
    assert verdict.startswith("Unknown: every conversion on vermithor keeps up")
    assert verdict.endswith("but meleys couldn't be asked.")
    assert loads.as_dict()["load_is_a_plausible_cause"] is None
    services.tautulli["vermithor"] = Down()
    assert (await read_loads(services)).verdict() == "Unknown: no server's Tautulli answered."


class Broken:
    async def activity(self):
        raise KeyError("stream_count")


async def test_a_bug_reading_a_host_isnt_passed_off_as_the_host_being_down(services):
    services.tautulli["meleys"] = Broken()
    with pytest.raises(KeyError):
        await read_loads(services)


async def test_a_streams_host_is_read_without_it(services):
    mine = transcode(0.6, session_key="1")
    services.tautulli["vermithor"].sessions = [mine, session(session_key="2")]
    load = (await read_loads(services)).hosts["vermithor"]
    assert load.busy and not load.without(mine).busy
    assert load.without(mine).as_dict()["streams"] == 1


async def test_remote_streams_are_summed_by_what_they_send(services):
    services.tautulli["meleys"].sessions = [
        session(location="wan", stream_bitrate_kbps=8000, relayed=True),
        session(location="lan", stream_bitrate_kbps=40000),
        session(location="cellular", stream_bitrate_kbps=2000),
    ]
    loads = await read_loads(services)
    meleys = loads.hosts["meleys"].as_dict()
    assert (meleys["remote_streams"], meleys["remote_mbps"], meleys["relayed_streams"]) == (
        2,
        10.0,
        1,
    )
    assert loads.remote_kbps == 10000
