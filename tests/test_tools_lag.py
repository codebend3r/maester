import time

from maester.agent.tools import Tier, registry
from maester.clients import ClientError
from maester.clients.plex import PlexItem, Version
from maester.clients.speedtest import SpeedResult
from maester.tools.lag import server_status, session_report, speed_test
from tests.factories import history_row, session
from tests.playback_world import DUNE


class Down:
    base_url = "http://meleys.lan:8181"

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
    ctx.services.speedtest.result = SpeedResult(3200, 500_000, 11.0, "Bell, Toronto", "Bell", "u")
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


async def test_session_report_needs_their_tautulli_account(ctx):
    out = await session_report(ctx)
    assert out.is_error and "isn't matched to a Tautulli user" in out.content


async def test_session_report_with_nothing_playing(ctx):
    ctx.store.upsert_user("d1", tautulli_user_id=7)
    ctx.services.tautulli["meleys"].sessions = [session(user_id=8)]  # someone else's
    out = await session_report(ctx)
    assert out["streams"] == [] and out["note"].startswith("Nothing is playing for them")


async def test_session_report_gives_one_fix_and_the_details_on_request(ctx):
    ctx.store.upsert_user("d1", tautulli_user_id=7)
    ctx.services.tautulli["vermithor"].sessions = [
        session(user_id=7, relayed=True, quality_profile="2 Mbps 720p", stream_bitrate_kbps=1800,
                transcode_decision="transcode", video_decision="transcode"),
    ]  # fmt: skip
    ctx.services.tautulli["meleys"] = Down()
    out = await session_report(ctx)
    (brief,) = out["streams"]
    assert brief["host"] == "vermithor" and brief["advice"]["fix"] == "avoid_relay"
    assert "relayed through Plex, which carries at most 2 Mbps" in brief["stream"]
    assert "playback" not in brief and "details=true" in out["note"]
    speed, down = sorted(out["notes"])
    assert "speed_test(host=meleys)" in speed and down.startswith(
        "couldn't reach Tautulli on meleys"
    )

    detailed = await session_report(ctx, details=True)
    (stream,) = detailed["streams"]
    assert stream["findings"][0]["fix"] == "avoid_relay" and stream["playback"]["relayed"]
    assert "note" not in detailed


async def test_session_report_uses_a_recent_speed_test(ctx):
    ctx.store.upsert_user("d1", tautulli_user_id=7)
    ctx.services.tautulli["vermithor"].sessions = [
        session(user_id=7, stream_bitrate_kbps=8000, source_bitrate_kbps=8000)
    ]
    ctx.services.speedtest.result = SpeedResult(2500, 300_000, 9.0, "Bell", "Bell", "u")
    await speed_test(ctx, "meleys")
    (brief,) = (await session_report(ctx))["streams"]
    assert (
        brief["advice"]["fix"] == "lower_quality"
        and "only 2.5 Mbps free" in brief["advice"]["cause"]
    )
    assert "notes" not in await session_report(ctx)


async def test_nothing_playing_says_which_servers_couldnt_be_asked(ctx):
    ctx.store.upsert_user("d1", tautulli_user_id=7)
    ctx.services.tautulli["meleys"] = Down()
    out = await session_report(ctx)
    assert out["note"].startswith(
        "Nothing is playing for them on the servers that answered (vermithor)"
    )


async def test_a_heavy_remux_streamed_away_from_home_is_flagged_from_the_report(ctx):
    ctx.store.upsert_user("d1", tautulli_user_id=7)
    ctx.services.seerr.details[("movie", 438631)] = DUNE
    remux = Version("4k", "hevc", 62103, 72_600_000_000, "/Vermithor/Movies/Dune (2021) Remux-2160p.mkv")  # fmt: skip
    ctx.services.plex.items = {"9001": PlexItem("9001", "Dune", "movie", 2021, ("tmdb://438631",), (remux,))}  # fmt: skip
    tautulli = ctx.services.tautulli["vermithor"]
    tautulli.sessions = [session(user_id=7, rating_key="9001", file=remux.file, stream_bitrate_kbps=62103)]  # fmt: skip
    now = int(time.time())
    tautulli.history_rows = [history_row(rating_key="9001", location="wan", user_id=u, started=now - 60) for u in (1, 2, 3)]  # fmt: skip
    out = await session_report(ctx)
    (notice,) = out.notices
    assert "candidate for the HEVC re-encode" in notice.text
    assert out.content["streams"][0]["advice"]["fix"] == "lower_quality"  # no lighter version
