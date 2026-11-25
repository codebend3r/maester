from datetime import timedelta

from sparrow.agent.tools import Failed, Refused, Tier, registry
from sparrow.clients.raven import RavenItem, RavenTitle
from sparrow.clients.speedtest import SpeedResult
from sparrow.perf.uplink import SPEED_TEST, Uplink
from sparrow.tools.versions import GUESSED, pick_version
from tests.factories import raven_file
from tests.playback_world import DUNE

REMUX = raven_file()
REENCODE = raven_file(id=402, hdr=False, bitrate_kbps=18_400, variant="2160p HEVC")
WEBDL = raven_file(id=403, width=1920, video_codec="h264", hdr=False, bitrate_kbps=10_200)


def dune(ctx, *files):
    ctx.services.seerr.details[("movie", 438631)] = DUNE
    raven = ctx.services.raven
    raven.titles = [RavenTitle(4, "4K Movies", "movie", "Dune", 2021, 40)]
    raven.items = {
        40: RavenItem(40, "movie", "Dune", 2021, 438631, files or (WEBDL, REMUX, REENCODE))
    }


async def test_versions_are_listed_and_one_recommended_for_the_speed_given(ctx):
    dune(ctx)
    out = await pick_version(ctx, 438631, connection_mbps=20)
    assert [(v["version"], v["bitrate_mbps"]) for v in out["versions"]] == [
        ("1080p (H.264)", 10.2), ("4K HDR (HEVC)", 62.1), ("2160p HEVC, 4K (HEVC)", 18.4),
    ]  # fmt: skip
    assert out["recommended"] == {
        "version": "1080p (H.264)",
        "fits": True,
        "quality_menu": "Play original quality",
        "connection": "about 20 Mbps: you said about 20 Mbps",
    }
    assert (await pick_version(ctx, 438631, connection_mbps=30))["recommended"]["version"] == (
        "2160p HEVC, 4K (HEVC)"
    )
    assert (await pick_version(ctx, 438631, connection_mbps=500))["recommended"]["version"] == (
        "4K HDR (HEVC)"
    )
    assert "note" not in out
    assert ctx.services.raven.viewers  # read as the asker


async def test_with_nothing_known_a_typical_connection_is_assumed_and_said(ctx):
    dune(ctx)
    out = await pick_version(ctx, 438631)
    assert out["note"] == GUESSED and out["recommended"]["version"] == "1080p (H.264)"


async def test_the_last_speed_test_limits_it_too(ctx):
    dune(ctx)
    measured = Uplink("meleys", SpeedResult(6_000, 1, 1.0, "s", "i", "u"))
    await ctx.memo.fresh(SPEED_TEST, timedelta(minutes=20), lambda: _now(measured))
    out = await pick_version(ctx, 438631, connection_mbps=500)
    assert out["recommended"] == {
        "version": "1080p (H.264)",
        "fits": False,
        "quality_menu": "Convert to 720p HD (High)",
        "connection": "about 6 Mbps: the servers' free upload at the last test",
    }


async def _now(value):
    return value


async def test_a_movie_raven_does_not_hold_or_cannot_be_searched(ctx):
    dune(ctx)
    ctx.services.raven.items = {}
    out = await pick_version(ctx, 438631)
    assert out["versions"] == [] and "No version of it is in raven" in out["note"]
    ctx.services.raven.down = True
    assert isinstance(await pick_version(ctx, 438631), Failed)
    assert isinstance(await pick_version(ctx, 438631, connection_mbps=0), Refused)


def test_tool_is_registered_for_friends():
    assert registry.get("pick_version").tier == Tier.FRIEND
