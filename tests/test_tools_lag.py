from maester.agent.tools import Tier, registry
from maester.clients import ClientError
from maester.tools.lag import server_status
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
