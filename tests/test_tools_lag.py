from maester.agent.tools import Tier, registry
from maester.clients import ClientError
from maester.clients.speedtest import SpeedResult
from maester.tools.lag import server_status, speed_test
from tests.factories import session


class Down:
    async def activity(self):
        raise ClientError("tautulli", "GET", "/api/v2", None, "connection refused")


async def test_server_status_reports_each_host_and_survives_a_dead_one(ctx):
    ctx.services.tautulli["vermithor"].sessions = [
        session(),
        session(relayed=True, transcode_decision="transcode", bandwidth_kbps=2000,
                stream_bitrate_kbps=2000, transcode_speed=0.6),
    ]  # fmt: skip
    ctx.services.tautulli["meleys"] = Down()
    out = await server_status(ctx)
    assert out["hosts"]["vermithor"] == {
        "streams": 2,
        "transcodes": 1,
        "transcodes_behind": 1,
        "bandwidth_mbps": 10.0,
        "remote_streams": 2,
        "remote_mbps": 10.0,
        "relayed_streams": 1,
        "busy": True,
        "why_busy": ["1 stream converting slower than playback"],
    }
    assert "connection refused" in out["unreachable"]["meleys"]
    assert out["load_is_a_plausible_cause"] is True and out["verdict"].startswith("Yes")


async def test_server_status_without_tautulli(ctx):
    ctx.services.tautulli = {}
    out = await server_status(ctx)
    assert out.is_error and "No Tautulli instance is configured" in out.content


def test_tool_is_registered_for_friends():
    assert "server_status" in {s.name for s in registry.for_tier(Tier.FRIEND)}


async def test_speed_test_runs_on_the_host_maester_runs_on(ctx):
    ctx.services.speedtest.result = SpeedResult(3.2, 500.0, 11.0, "Bell, Toronto", "Bell", "u")
    ctx.services.tautulli["vermithor"].sessions = [session(location="wan", stream_bitrate_kbps=18500)]  # fmt: skip
    out = await speed_test(ctx, "Meleys")
    assert (out["host"], out["upload_mbps"], out["remote_streams_mbps"]) == ("meleys", 3.2, 18.5)
    assert out["headroom"].startswith("The upload is nearly full")
    elsewhere = await speed_test(ctx, "vermithor")
    assert elsewhere.is_error and "Speed tests run on meleys" in elsewhere.content
    assert ctx.services.speedtest.runs == 1


async def test_speed_test_refuses_when_it_fails_or_isnt_set_up(ctx):
    failed = await speed_test(ctx, "meleys")
    assert failed.is_error and "no test server answered" in failed.content
    assert "the next can run in about 20 min" in failed.content
    ctx.services.speedtest = None
    missing = await speed_test(ctx, "meleys")
    assert missing.is_error and "SPEEDTEST_HOST" in missing.content
