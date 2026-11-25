from sparrow.clients.fleet import Vitals
from sparrow.clients.raven import PlaybackMode
from sparrow.perf.load import read_loads
from tests.factories import live_stream


async def test_cpu_and_memory_from_the_fleet_monitor_make_a_host_busy(services):
    services.fleet.readings = {"meleys": Vitals(97.0, 40.0), "vermithor": Vitals(30.0, 93.5)}
    loads = await read_loads(services.fleet)
    assert loads.hosts["meleys"].strain == ("its CPU is at 97%",)
    assert loads.hosts["vermithor"].strain == ("its memory is 94% used",)
    assert loads.verdict() == (
        "Yes, the server is busy (meleys: its CPU is at 97%; vermithor: its memory is 94% used)."
    )
    facts = loads.as_dict()
    assert facts["load_is_a_plausible_cause"] is True
    assert facts["hosts"]["meleys"] == {
        "cpu_percent": 97.0, "memory_percent": 40.0, "busy": True, "why_busy": ["its CPU is at 97%"],
    }  # fmt: skip


async def test_a_calm_server_is_unlikely_and_only_what_was_read_is_fine(services):
    services.fleet.readings = {"meleys": Vitals(12.0, 50.0), "vermithor": Vitals(20.0, 40.0)}
    loads = await read_loads(services.fleet)
    assert loads.verdict() == "Unlikely: CPU and memory on meleys, vermithor are fine."
    assert loads.as_dict()["load_is_a_plausible_cause"] is False
    services.fleet.readings = {"meleys": Vitals(12.0, None)}
    partial = await read_loads(services.fleet)
    assert partial.plausible is None and partial.verdict().startswith(
        "Unknown: no recent CPU or memory reading for meleys"
    )


async def test_without_a_monitor_or_with_it_down_nothing_is_called_fine(services):
    loads = await read_loads(None)
    assert loads.plausible is None and loads.hosts == {}
    assert loads.verdict() == "Unknown: CPU and memory are unknown: no fleet monitor is set up."
    services.fleet.down = True
    down = await read_loads(services.fleet)
    assert "the fleet monitor didn't answer" in down.as_dict()["cpu_and_memory"]


async def test_raven_s_streams_are_counted_when_its_owner_asks(services):
    raven = services.raven
    raven.live = [
        live_stream(mode=PlaybackMode.TRANSCODE, address="203.0.113.9", send_kbps=8000),
        live_stream(mode=PlaybackMode.REMUX, send_kbps=40_000),
    ]
    loads = await read_loads(services.fleet, raven)
    assert loads.as_dict()["raven"] == {
        "streams": 2, "transcodes": 1, "remuxes": 1, "away_from_home": 1, "sending_mbps": 48.0,
    }  # fmt: skip
    raven.down = True
    assert "couldn't be read" in (await read_loads(None, raven)).as_dict()["raven"]
    assert "raven" not in (await read_loads(services.fleet)).as_dict()
