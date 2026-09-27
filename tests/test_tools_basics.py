from types import SimpleNamespace

from maester.agent.tools import Tier, ToolContext, registry
from maester.clients import FakeTautulliClient
from maester.clients.tautulli import Session
from maester.tools.basics import server_status


def session(**kw) -> Session:
    base = dict(
        session_key="1", user_id=1, user="u", rating_key="1", full_title="Dune", media_type="movie",
        state="playing", progress_percent=10, platform="Roku", player="TV", product="Plex",
        location="wan", relayed=False, secure=True, bandwidth_kbps=8000, stream_bitrate_kbps=8000,
        transcode_decision="direct play", video_decision="", audio_decision="", subtitle_decision="",
        transcode_reasons=(), container="mkv", video_codec="hevc", video_resolution="4k",
        video_dynamic_range="SDR", audio_codec="eac3", audio_channels=6, subtitle_codec="",
        quality_profile="Original", file="/x.mkv",
    )  # fmt: skip
    return Session(**{**base, **kw})


class Broken:
    async def activity(self):
        raise ConnectionError("down")


async def test_server_status_reports_each_host_and_survives_a_dead_one():
    services = SimpleNamespace(
        tautulli={
            "vermithor": FakeTautulliClient(
                host="vermithor",
                sessions=[
                    session(),
                    session(relayed=True, transcode_decision="transcode", bandwidth_kbps=2000),
                ],
            ),
            "meleys": Broken(),
        }
    )
    ctx = ToolContext(user_id="u", tier=Tier.FRIEND, services=services)
    out = await server_status(ctx)
    assert out["hosts"]["vermithor"] == {
        "reachable": True,
        "streams": 2,
        "transcodes": 1,
        "total_bandwidth_mbps": 10.0,
        "wan_bandwidth_mbps": 10.0,
        "relayed_streams": 1,
    }
    assert (
        out["hosts"]["meleys"]["reachable"] is False and "down" in out["hosts"]["meleys"]["error"]
    )


async def test_server_status_without_tautulli():
    out = await server_status(
        ToolContext(user_id="u", tier=Tier.FRIEND, services=SimpleNamespace(tautulli={}))
    )
    assert "error" in out


def test_tool_is_registered_for_friends():
    assert "server_status" in {s.name for s in registry.for_tier(Tier.FRIEND)}
