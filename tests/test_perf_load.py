from maester.clients import ClientError
from maester.clients.fleet import Vitals
from maester.perf.load import read_loads
from tests.factories import session


def transcode(speed: float, *, throttled: bool = False, **kw):
    return session(transcode_decision="transcode", transcode_speed=speed, transcode_throttled=throttled, **kw)  # fmt: skip


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
        "caraxes": Vitals(99.0, 99.0),  # no Plex host maester knows
    }
    loads = await read_loads(services)
    assert loads.hosts["meleys"].strain == ("its CPU is at 97%",)
    assert loads.hosts["vermithor"].strain == ("its memory is 94% used",)
    assert set(loads.hosts) == {"meleys", "vermithor"}
    facts = loads.as_dict()["hosts"]["meleys"]
    assert (facts["cpu_percent"], facts["memory_percent"], facts["busy"]) == (97.0, 40.0, True)


async def test_a_calm_server_is_unlikely_to_be_the_cause(services):
    services.fleet.readings = {"meleys": Vitals(12.0, 50.0)}
    loads = await read_loads(services)
    assert loads.verdict() == "Unlikely: every conversion keeps up, and CPU and memory are fine."
    assert "cpu_and_memory" not in loads.as_dict()


async def test_without_the_fleet_monitor_cpu_and_memory_are_unknown(services):
    services.fleet = None
    loads = await read_loads(services)
    assert loads.vitals_note == "unknown: no fleet monitor is set up"
    assert loads.verdict() == "Unlikely: every conversion keeps up."
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
    assert loads.verdict() == "Unlikely: every conversion keeps up (meleys couldn't be asked)."


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
