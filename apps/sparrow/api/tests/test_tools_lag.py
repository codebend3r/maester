from dataclasses import replace

from sparrow.agent.tools import Failed, Refused, Tier, registry
from sparrow.clients.fleet import Vitals
from sparrow.clients.raven import PlaybackMode, RavenItem
from sparrow.clients.speedtest import SpeedResult
from sparrow.tools.lag import IN_BRIEF, NOTHING_PLAYING, server_status, session_report, speed_test
from tests.factories import live_stream, raven_file

AWAY = "203.0.113.9"
REMUX = raven_file()
HD = raven_file(id=402, width=1920, video_codec="h264", hdr=False, bitrate_kbps=10_200)


def playing(ctx, *streams):
    raven = ctx.services.raven
    raven.items = {40: RavenItem(40, "movie", "Dune", 2021, 438631, (REMUX, HD))}
    raven.mine = list(streams)


def test_tools_are_registered_for_friends():
    names = {s.name for s in registry.for_tier(Tier.FRIEND)}
    assert {"server_status", "session_report", "speed_test"} <= names


async def test_session_report_with_nothing_playing(ctx):
    out = await session_report(ctx)
    assert out == {"streams": [], "note": NOTHING_PLAYING}


async def test_session_report_gives_one_fix_and_the_details_on_request(ctx):
    playing(ctx, live_stream(mode=PlaybackMode.TRANSCODE))
    brief = await session_report(ctx)
    (stream,) = brief["streams"]
    assert brief["note"] == IN_BRIEF and stream["title"] == "Dune"
    assert stream["advice"]["fix"] == "other_version" and "findings" not in stream
    (detailed,) = (await session_report(ctx, details=True))["streams"]
    assert detailed["findings"] and detailed["mode"] == "transcode"
    assert "note" not in await session_report(ctx, details=True)
    assert ctx.services.raven.viewers  # the asker's own streams


async def test_a_speed_test_is_suggested_away_from_home_only_when_one_would_run(ctx):
    playing(ctx, live_stream(address=AWAY))
    out = await session_report(ctx)
    assert "speed_test(host=meleys)" in out["notes"][0]
    playing(ctx, live_stream())
    assert "notes" not in await session_report(ctx)


async def test_session_report_when_raven_is_down(ctx):
    ctx.services.raven.down = True
    out = await session_report(ctx)
    assert isinstance(out, Failed) and out.retryable


async def test_server_status_reads_the_fleet_and_raven_s_streams_for_the_admin(ctx):
    ctx.services.fleet.readings = {"vermithor": Vitals(96.0, 70.0)}
    ctx.services.raven.live = [live_stream(mode=PlaybackMode.TRANSCODE)]
    friend = await server_status(ctx)
    assert friend["load_is_a_plausible_cause"] is True and "raven" not in friend
    admin = await server_status(replace(ctx, tier=Tier.ADMIN))
    assert admin["raven"]["transcodes"] == 1
    ctx.services.fleet = None
    assert isinstance(await server_status(ctx), Refused)
    assert "raven" in await server_status(replace(ctx, tier=Tier.ADMIN))


async def test_speed_test_runs_on_the_host_sparrow_runs_on(ctx):
    ctx.services.speedtest.result = SpeedResult(3200, 500_000, 11.0, "Bell, Toronto", "Bell", "u")
    out = await speed_test(ctx, "Meleys")
    assert (out["host"], out["upload_mbps"]) == ("meleys", 3.2)
    assert out["headroom"].startswith("The upload is nearly full")
    elsewhere = await speed_test(ctx, "vermithor")
    assert isinstance(elsewhere, Refused) and "Speed tests run on meleys" in elsewhere.content
    assert ctx.services.speedtest.runs == 1


async def test_speed_test_refuses_when_it_fails_or_isnt_set_up(ctx):
    failed = await speed_test(ctx, "meleys")
    assert isinstance(failed, Refused) and "no test server answered" in failed.content
    assert "the next can run in about 20 min" in failed.content
    ctx.services.speedtest = None
    missing = await speed_test(ctx, "meleys")
    assert isinstance(missing, Refused) and "SPEEDTEST_HOST" in missing.content
